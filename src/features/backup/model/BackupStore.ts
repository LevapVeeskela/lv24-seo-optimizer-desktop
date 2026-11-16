import { toAppError, type AppError } from "@/shared/lib/errors";
import { isRecord } from "@/shared/lib/format";
import { makeAutoObservable } from "mobx";
import { runBackupCreate, type BackupCreateArgs } from "../lib/ipc";
import { normalizeBackupResult, type BackupResult } from "./types";

export type BackupState = "idle" | "creating" | "ready" | "error";

export type BackupCreateFn = (
  args: BackupCreateArgs,
) => ReturnType<typeof runBackupCreate>;

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
  private generation = 0;
  private readonly create: BackupCreateFn;
  private readonly now: () => Date;

  constructor(
    create: BackupCreateFn = runBackupCreate,
    now: () => Date = () => new Date(),
  ) {
    this.create = create;
    this.now = now;
    makeAutoObservable<BackupStore, "generation" | "create" | "now">(
      this,
      { generation: false, create: false, now: false },
      { autoBind: true },
    );
  }

  get creating(): boolean {
    return this.state === "creating";
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
  }
}
