import type { CliCommandId } from "@/shared/cli";

/**
 * Long engine calls the UI may run in the background. Every kind maps to one
 * allow-listed command; short reads (`stats`, `report_diff`, `doctor`, …) are
 * deliberately absent, so they never grow a banner or a Cancel button.
 */
export const RUN_KINDS = [
  "crawl",
  "reportWeekly",
  "logsAnalyze",
  "backupCreate",
  "backupRestore",
  "scheduleInstall",
] as const;

export type RunKind = (typeof RUN_KINDS)[number];

/**
 * The one allow-listed command behind each kind. Keeping this mapping here
 * makes it impossible for a tracked run to name a short read: the shell would
 * reject the run id with `RUN_NOT_CANCELLABLE`, and the UI must not expose a
 * Cancel button for a command that is not cancellable.
 */
export const RUN_KIND_COMMANDS: Record<RunKind, CliCommandId> = {
  crawl: "crawl",
  reportWeekly: "report_weekly",
  logsAnalyze: "logs_analyze",
  backupCreate: "backup_create",
  backupRestore: "backup_restore",
  scheduleInstall: "schedule_install",
};

/**
 * `cancelling` is the short window between the click and the shell's answer.
 * `cancelled` is only set from the shell's `RUN_CANCELLED` result (or when the
 * shell accepted the cancel for a run that then failed), never from the click.
 */
export type RunStatus =
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunRecord {
  readonly id: string;
  readonly kind: RunKind;
  readonly command: CliCommandId;
  readonly startedAt: number;
  status: RunStatus;
  finishedAt: number | null;
  durationMs: number | null;
  errorCode: string | null;
  cancelRequested: boolean;
  dismissed: boolean;
}
