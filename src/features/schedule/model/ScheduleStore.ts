import { cliRun } from "@/shared/cli";
import { toAppError, type AppError } from "@/shared/lib/errors";
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

export const DEFAULT_CRON = "0 6 * * 1";

export type ScheduleState = "idle" | "loading" | "ready" | "error";

/**
 * Print-only schedule preview. The store calls `schedule_print` and keeps the
 * rendered artifact in memory; it never installs a cron entry, systemd unit or
 * Windows task.
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
  private generation = 0;

  constructor() {
    makeAutoObservable<ScheduleStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get validation(): CronValidation {
    return validateCron(this.cron);
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

  /**
   * Drop a result that belongs to a previous workspace. Bumping the generation
   * also discards a render that is still in flight.
   */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.artifact = null;
    this.meta = {};
    this.warnings = [];
    this.error = null;
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
}
