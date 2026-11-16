import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { trackRun } from "@/shared/run/lib/trackedRun";
import type { RunStore } from "@/shared/run/model/RunStore";
import { makeAutoObservable } from "mobx";
import {
  defaultScheduleTarget,
  isScheduleTarget,
  scheduleView,
  validateCron,
  type CronValidation,
  type ScheduleTarget,
  type ScheduleView,
} from "@/entities/integrations";
import { scheduleInstallView, type ScheduleInstallResult } from "./install";

export const DEFAULT_CRON = "0 6 * * 1";

/** The two report kinds `schedule install` understands. */
export const SCHEDULE_KINDS = ["weekly", "daily"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export type ScheduleState = "idle" | "loading" | "ready" | "error";
export type ScheduleInstallState =
  | "idle"
  | "installing"
  | "installed"
  | "error"
  | "cancelled";

function installError(error: unknown): AppError {
  const app = toAppError(error, "CLI_FAILED");
  if (app.code === "CLI_INVALID_JSON" && !app.nextAction) {
    return {
      ...app,
      nextAction:
        "the installed engine may not support schedule install yet; update it and retry",
    };
  }
  return app;
}

/**
 * Scheduler state. `generate` only renders an artefact; `requestInstall` opens
 * the confirmation dialog and `confirmInstall` is the only method that asks
 * the engine to write a host job. No install path exists without that
 * explicit confirmation.
 */
export class ScheduleStore {
  cron = DEFAULT_CRON;
  /** `null` follows the host platform until the user picks a target. */
  target: ScheduleTarget | null = null;
  state: ScheduleState = "idle";
  artifact: ScheduleView | null = null;
  meta: Record<string, unknown> = {};
  warnings: string[] = [];
  error: AppError | null = null;

  installKind: ScheduleKind = "weekly";
  /** Empty means "use the engine default for the selected kind". */
  installCron = "";
  installState: ScheduleInstallState = "idle";
  /** Set only by `requestInstall`; `confirmInstall` refuses without it. */
  installPending = false;
  installResult: ScheduleInstallResult | null = null;
  installWarnings: string[] = [];
  installError: AppError | null = null;

  private generation = 0;
  private installGeneration = 0;
  private readonly runs: RunStore | null;

  constructor(runs: RunStore | null = null) {
    this.runs = runs;
    makeAutoObservable<
      ScheduleStore,
      "generation" | "installGeneration" | "runs"
    >(
      this,
      { generation: false, installGeneration: false, runs: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get installing(): boolean {
    return this.installState === "installing";
  }

  get validation(): CronValidation {
    return validateCron(this.cron);
  }

  /** Empty override is valid: the engine picks the kind's default cron. */
  get installCronValue(): string {
    const trimmed = this.installCron.trim();
    return trimmed ? trimmed.split(/\s+/).join(" ") : "";
  }

  get installCronValidation(): CronValidation {
    const value = this.installCronValue;
    return value ? validateCron(value) : { valid: true };
  }

  /** A concrete target for the engine; the UI shows the resolved value. */
  resolveTarget(platform: string | null | undefined): ScheduleTarget {
    return this.target ?? defaultScheduleTarget(platform);
  }

  setCron(value: string): void {
    this.cron = value;
    this.invalidate();
  }

  setTarget(value: string): void {
    if (!isScheduleTarget(value)) {
      return;
    }
    this.target = value;
    this.invalidate();
  }

  setInstallKind(value: string): void {
    const kind = SCHEDULE_KINDS.find((item) => item === value);
    if (!kind) {
      return;
    }
    this.installKind = kind;
    this.invalidateInstall();
  }

  setInstallCron(value: string): void {
    this.installCron = value;
    this.invalidateInstall();
  }

  async generate(
    configPath: string | null,
    platform: string | null | undefined,
  ): Promise<boolean> {
    if (!this.validation.valid) {
      // The inline field error is the answer; never spend an engine call on a
      // cron expression the scheduler would reject.
      return false;
    }
    const generation = ++this.generation;
    this.state = "loading";
    this.error = null;
    const result = await cliRun<unknown>("schedule_print", {
      args: { cron: this.cron.trim(), target: this.resolveTarget(platform) },
      ...(configPath ? { configPath } : {}),
    });
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      const artifact = scheduleView(result.data);
      this.artifact = artifact;
      this.meta = result.meta;
      this.warnings = [
        ...new Set([...result.warnings, ...artifact.warnings]),
      ].filter((item) => item.trim() !== "");
      this.state = "ready";
      return true;
    }
    this.artifact = null;
    this.meta = result.meta;
    this.warnings = result.warnings;
    this.error = toAppError(result.error, "CLI_FAILED");
    this.state = "error";
    return false;
  }

  /** Open the confirmation dialog; never calls the engine. */
  requestInstall(): boolean {
    if (!SCHEDULE_KINDS.includes(this.installKind)) {
      this.installError = {
        code: "SCHEDULE_KIND_INVALID",
        message: "Choose the weekly or daily report.",
        retryable: false,
      };
      return false;
    }
    if (!this.installCronValidation.valid) {
      // The inline field error is the answer; do not install a cron the
      // scheduler would reject.
      return false;
    }
    this.installPending = true;
    return true;
  }

  cancelInstall(): void {
    this.installPending = false;
  }

  /**
   * Apply the install after the dialog. A direct call without
   * `requestInstall` is refused before the engine is spawned.
   */
  async confirmInstall(configPath: string | null): Promise<boolean> {
    if (!this.installPending) {
      this.installError = {
        code: "SCHEDULE_NOT_CONFIRMED",
        message: "Confirm the install in the dialog before writing a host job.",
        retryable: false,
      };
      return false;
    }
    this.installPending = false;
    if (!configPath) {
      this.installError = {
        code: "SCHEDULE_CONFIG_MISSING",
        message: "Open a workspace before installing a schedule.",
        retryable: false,
      };
      this.installState = "error";
      return false;
    }
    const cron = this.installCronValue;
    const generation = ++this.installGeneration;
    this.installState = "installing";
    this.installError = null;
    const args = {
      kind: this.installKind,
      ...(cron ? { cron } : {}),
      // The engine plans by default; this is the confirmed host-write opt-in.
      allowWrite: true,
    };
    const result = this.runs
      ? await trackRun(this.runs, {
          kind: "scheduleInstall",
          run: (runId) =>
            cliRun<unknown>("schedule_install", {
              args,
              configPath,
              runId,
            }),
        })
      : await cliRun<unknown>("schedule_install", { args, configPath });
    if (generation !== this.installGeneration) {
      return false;
    }
    if (!result.ok && result.error.code === "RUN_CANCELLED") {
      this.installResult = null;
      this.installError = null;
      this.installWarnings = result.warnings;
      this.installState = "cancelled";
      return false;
    }
    if (result.ok) {
      const installed = scheduleInstallView(result.data);
      this.installResult = installed;
      this.installWarnings = [
        ...new Set([...result.warnings, ...installed.warnings]),
      ].filter((item) => item.trim() !== "");
      this.installState = "installed";
      return true;
    }
    this.installResult = null;
    this.installWarnings = result.warnings;
    this.installError = installError(result.error);
    this.installState = "error";
    return false;
  }

  /**
   * Drop a result that belongs to a previous workspace. Bumping the generation
   * also discards a render or install that is still in flight.
   */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.artifact = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
    this.invalidateInstall();
  }

  /** Editing the form makes the previous artifact stale; hide it. */
  private invalidate(): void {
    this.generation += 1;
    this.state = "idle";
    this.artifact = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
  }

  /** Editing the install form drops the previous result and confirmation. */
  private invalidateInstall(): void {
    this.installGeneration += 1;
    this.installState = "idle";
    this.installPending = false;
    this.installResult = null;
    this.installWarnings = [];
    this.installError = null;
  }
}
