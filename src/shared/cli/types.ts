/** Command ids exposed by the desktop shell's fixed `cli_run` allow-list. */
export const CLI_COMMAND_IDS = [
  "version",
  "stats",
  "config_show",
  "doctor",
  "properties",
  "auth_status",
  "report_weekly",
  "report_diff",
  "crawl",
  "init",
  "schedule_print",
  "logs_analyze",
  "tasks_list",
  "tasks_add",
  "tasks_update",
  "backup_create",
  "backup_restore",
  "portfolio_list",
  "schedule_install",
] as const;

export type CliCommandId = (typeof CLI_COMMAND_IDS)[number];

/** Typed CLI failure from the standard `{ok:false,error}` envelope. */
export interface CliError {
  code: string;
  message: string;
  next_action?: string;
  retryable?: boolean;
}

export interface EnvelopeBase {
  meta: Record<string, unknown>;
  warnings: string[];
}

export type Envelope<T> =
  | (EnvelopeBase & { ok: true; data: T })
  | (EnvelopeBase & { ok: false; error: CliError });

/** Arguments accepted by the Rust `CliArgs` struct; camelCase over IPC. */
export interface CliArgs {
  days?: number;
  lagDays?: number;
  base?: string;
  head?: string;
  start?: string;
  maxUrls?: number;
  /** `report_weekly` output directory / `backup_create` destination. */
  out?: string;
  /** `init` only: site URL, `sc-domain:` property, or a bare host. */
  property?: string;
  /**
   * `init` (creates it), `schedule_print`/`schedule_install` and
   * `backup_restore` (must equal the active config): absolute path to the
   * project `seo.toml`. For `init` the top-level `CliRunOptions.configPath` is
   * accepted as an alias.
   */
  configPath?: string;
  /** `init` only: absolute data directory; its parent must exist. */
  dataDir?: string;
  /** `schedule_print` and `schedule_install`: five-field cron expression. */
  cron?: string;
  /** `schedule_print` only: scheduler dialect. */
  target?: "cron" | "systemd" | "windows";
  /**
   * `logs_analyze` (access log) and `backup_restore` (backup archive): absolute
   * file returned by the native picker.
   */
  file?: string;
  /** `logs_analyze` only: bot filter; empty or omitted means all bots. */
  bot?: "googlebot" | "yandexbot" | "bingbot" | "other" | "";
  /** `tasks_list` filter / `tasks_add` kind / `schedule_install` report kind. */
  kind?: string;
  /** `tasks_list` filter / `tasks_update` target state. */
  state?: "open" | "in_progress" | "verified" | "dismissed";
  /** `tasks_list` rows (1..500) / `portfolio_list` projects (1..50). */
  limit?: number;
  /** `tasks_add` only: absolute or site-relative URL. */
  url?: string;
  /** `tasks_add` only: rule/finding id that produced the task. */
  rule?: string;
  /** `tasks_add` only: evidence object, JSON-encoded (16 KiB cap). */
  payload?: Record<string, unknown>;
  /** `tasks_update` only: positive task id. */
  id?: number;
  /** `backup_create` only: replace a same-second archive. */
  force?: boolean;
  /**
   * `backup_restore` only: explicit opt-in for the apply phase. The plan phase
   * must omit it; the UI never sends it before the confirmation dialog.
   */
  allowWrite?: boolean;
  /** `backup_restore` only: `confirmToken` returned by the plan phase. */
  confirm?: string;
  /** `portfolio_list` only: absolute projects directory from `pick_directory`. */
  root?: string;
}

export interface CliRunOptions {
  /** Structured, command-specific arguments validated by the shell. */
  args?: CliArgs;
  /** Absolute seo.toml path; the shell validates it against approved roots. */
  configPath?: string;
  /**
   * Stable id for a cancellable run. Only long local jobs accept it; the shell
   * rejects a run id for a short read (`RUN_NOT_CANCELLABLE`).
   */
  runId?: string;
}

/** Matches the Rust command signature `cli_run(command, args, configPath, runId)`. */
export interface CliRunRequest extends CliRunOptions {
  command: CliCommandId;
  args?: CliArgs;
}
