import { toAppError, type AppError } from "@/shared/lib/errors";
import { isRecord } from "@/shared/lib/format";
import { makeAutoObservable } from "mobx";
import {
  runBackupCreate,
  runBackupRestore,
  type BackupCreateArgs,
  type BackupRestoreArgs,
} from "../lib/ipc";
import {
  normalizeRestoreOutcome,
  normalizeRestorePlan,
  type RestoreOutcome,
  type RestorePlan,
} from "./restore";
import { normalizeBackupResult, type BackupResult } from "./types";

export type BackupState = "idle" | "creating" | "ready" | "error";

/**
 * Restore is deliberately two-phase: `planned` is the only state that can ask
 * for confirmation, and only a confirmed request may reach the engine with the
 * write opt-in and token.
 */
export type RestoreState =
  | "idle"
  | "planning"
  | "planned"
  | "restoring"
  | "restored"
  | "error";

export type BackupCreateFn = (
  args: BackupCreateArgs,
) => ReturnType<typeof runBackupCreate>;

export type BackupRestoreFn = (
  args: BackupRestoreArgs,
) => ReturnType<typeof runBackupRestore>;

/** A Typer usage error is what an engine without `backup restore` returns. */
function restoreError(error: unknown): AppError {
  const app = toAppError(error, "CLI_FAILED");
  if (app.code === "CLI_INVALID_JSON" && !app.nextAction) {
    return {
      ...app,
      nextAction:
        "the installed engine may not support backup restore yet; update it and retry",
    };
  }
  return app;
}

/**
 * Page-local backup state. A failed run keeps the previous archive visible
 * together with the error, so a transient engine failure never hides the
 * archive that already exists on disk.
 */
export class BackupStore {
  state: BackupState = "idle";
  /** Absolute output directory chosen through the shell picker. */
  outDir: string | null = null;
  force = false;
  result: BackupResult | null = null;
  warnings: string[] = [];
  error: AppError | null = null;
  lastRunAt: string | null = null;

  /** Absolute `.zip` chosen through the shell picker. */
  restoreFile: string | null = null;
  restoreState: RestoreState = "idle";
  restorePlan: RestorePlan | null = null;
  /** Set only by `requestRestore`; `confirmRestore` refuses without it. */
  restorePending = false;
  restoreOutcome: RestoreOutcome | null = null;
  restoreWarnings: string[] = [];
  restoreError: AppError | null = null;

  private generation = 0;
  private restoreGeneration = 0;
  private readonly create: BackupCreateFn;
  private readonly now: () => Date;
  private readonly restore: BackupRestoreFn;

  constructor(
    create: BackupCreateFn = runBackupCreate,
    now: () => Date = () => new Date(),
    restore: BackupRestoreFn = runBackupRestore,
  ) {
    this.create = create;
    this.now = now;
    this.restore = restore;
    makeAutoObservable<
      BackupStore,
      "generation" | "restoreGeneration" | "create" | "now" | "restore"
    >(
      this,
      {
        generation: false,
        restoreGeneration: false,
        create: false,
        now: false,
        restore: false,
      },
      { autoBind: true },
    );
  }

  get creating(): boolean {
    return this.state === "creating";
  }

  get planning(): boolean {
    return this.restoreState === "planning";
  }

  get restoring(): boolean {
    return this.restoreState === "restoring";
  }

  /** Apply needs a reviewed plan with a token, the archive and no busy run. */
  get restoreReady(): boolean {
    return (
      this.restoreState === "planned" &&
      Boolean(this.restoreFile) &&
      Boolean(this.restorePlan?.confirmToken)
    );
  }

  setOutDir(outDir: string | null): void {
    this.outDir = outDir?.trim() || null;
  }

  setForce(force: boolean): void {
    this.force = force;
  }

  async run(): Promise<boolean> {
    if (!this.outDir) {
      this.error = {
        code: "BACKUP_OUT_MISSING",
        message: "Choose an output directory before creating a backup.",
        retryable: false,
      };
      this.state = "error";
      return false;
    }
    const generation = ++this.generation;
    this.state = "creating";
    this.error = null;
    const result = await this.create({ out: this.outDir, force: this.force });
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      if (!isRecord(result.data)) {
        this.error = {
          code: "INVALID_BACKUP_RESULT",
          message: "backup_create returned no data object",
          retryable: false,
        };
        this.warnings = result.warnings;
        this.state = "error";
        return false;
      }
      this.result = normalizeBackupResult(result.data);
      this.warnings = result.warnings;
      this.lastRunAt = this.now().toISOString();
      this.state = "ready";
      return true;
    }
    this.error = toAppError(result.error, "CLI_FAILED");
    this.warnings = result.warnings;
    this.state = "error";
    return false;
  }

  /** Changing the archive invalidates the plan it was built from. */
  setRestoreFile(file: string | null): void {
    const next = file?.trim() || null;
    if (next === this.restoreFile) {
      return;
    }
    this.restoreFile = next;
    this.invalidateRestore();
  }

  /**
   * Plan phase: no `allowWrite`, no token. A successful plan is the only way
   * `restoreReady` becomes true.
   */
  async planRestore(configPath: string | null): Promise<boolean> {
    const file = this.restoreFile;
    if (!file) {
      this.restoreError = {
        code: "RESTORE_FILE_MISSING",
        message: "Choose a backup archive before reviewing a restore.",
        retryable: false,
      };
      this.restoreState = "error";
      return false;
    }
    if (!configPath) {
      this.restoreError = {
        code: "RESTORE_CONFIG_MISSING",
        message: "Open a workspace before restoring a backup.",
        retryable: false,
      };
      this.restoreState = "error";
      return false;
    }
    const generation = ++this.restoreGeneration;
    this.restoreState = "planning";
    this.restorePlan = null;
    this.restoreError = null;
    this.restorePending = false;
    this.restoreOutcome = null;
    const result = await this.restore({
      file,
      configPath,
      allowWrite: false,
      confirm: null,
    });
    if (generation !== this.restoreGeneration) {
      return false;
    }
    if (result.ok) {
      this.restorePlan = normalizeRestorePlan(result.data);
      this.restoreWarnings = result.warnings;
      this.restoreState = "planned";
      return true;
    }
    this.restorePlan = null;
    this.restoreError = restoreError(result.error);
    this.restoreWarnings = result.warnings;
    this.restoreState = "error";
    return false;
  }

  /** Open the confirmation dialog; never calls the engine. */
  requestRestore(): boolean {
    if (!this.restorePlan?.confirmToken) {
      this.restoreError = {
        code: "RESTORE_TOKEN_MISSING",
        message:
          "The restore plan has no confirmation token, so it cannot be applied.",
        retryable: false,
      };
      return false;
    }
    if (!this.restoreReady) {
      this.restoreError = {
        code: "RESTORE_NOT_READY",
        message: "Review the restore plan before applying it.",
        retryable: false,
      };
      return false;
    }
    this.restorePending = true;
    return true;
  }

  cancelRestore(): void {
    this.restorePending = false;
  }

  /**
   * Apply phase. The explicit `requestRestore` is the confirmation gate: a
   * direct call without it is refused before the engine sees the token.
   */
  async confirmRestore(configPath: string | null): Promise<boolean> {
    if (!this.restorePending) {
      this.restoreError = {
        code: "RESTORE_NOT_CONFIRMED",
        message: "Confirm the restore in the dialog before applying it.",
        retryable: false,
      };
      return false;
    }
    this.restorePending = false;
    const file = this.restoreFile;
    const token = this.restorePlan?.confirmToken ?? null;
    if (!file || !token || !configPath) {
      this.restoreError = {
        code: "RESTORE_NOT_READY",
        message: "The restore plan is incomplete; review it again.",
        retryable: false,
      };
      return false;
    }
    const generation = ++this.restoreGeneration;
    this.restoreState = "restoring";
    this.restoreError = null;
    const result = await this.restore({
      file,
      configPath,
      allowWrite: true,
      confirm: token,
    });
    if (generation !== this.restoreGeneration) {
      return false;
    }
    if (result.ok) {
      this.restoreOutcome = normalizeRestoreOutcome(
        result.data,
        this.restorePlan,
      );
      this.restoreWarnings = result.warnings;
      this.restoreState = "restored";
      return true;
    }
    this.restoreError = restoreError(result.error);
    this.restoreWarnings = result.warnings;
    this.restoreState = "error";
    return false;
  }

  /** Drop the archive and any in-flight run (workspace switch or unmount). */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.outDir = null;
    this.force = false;
    this.result = null;
    this.warnings = [];
    this.error = null;
    this.lastRunAt = null;
    this.restoreFile = null;
    this.invalidateRestore();
  }

  /** Drop the plan, the pending confirmation and any result. */
  private invalidateRestore(): void {
    this.restoreGeneration += 1;
    this.restoreState = "idle";
    this.restorePlan = null;
    this.restorePending = false;
    this.restoreOutcome = null;
    this.restoreWarnings = [];
    this.restoreError = null;
  }
}
