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
   * `init` (creates it) and `schedule_print` (must equal the active config):
   * absolute path to the project `seo.toml`. For `init` the top-level
   * `CliRunOptions.configPath` is accepted as an alias.
   */
  configPath?: string;
  /** `init` only: absolute data directory; its parent must exist. */
  dataDir?: string;
  /** `schedule_print` only: five-field cron expression. */
  cron?: string;
  /** `schedule_print` only: scheduler dialect. */
  target?: "cron" | "systemd" | "windows";
  /**
   * `logs_analyze` only: absolute regular access log returned by
   * `pick_log_file` (or located under the app data/export directories).
   */
  file?: string;
  /** `logs_analyze` only: bot filter; empty or omitted means all bots. */
  bot?: "googlebot" | "yandexbot" | "bingbot" | "other" | "";
  /** `tasks_list` filter / `tasks_add` task kind. */
  kind?: string;
  /** `tasks_list` filter / `tasks_update` target state. */
  state?: "open" | "in_progress" | "verified" | "dismissed";
  /** `tasks_list` only: 1..500 rows. */
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
}

export interface CliRunOptions {
  /** Structured, command-specific arguments validated by the shell. */
  args?: CliArgs;
  /** Absolute seo.toml path; the shell validates it against approved roots. */
  configPath?: string;
}

/** Matches the Rust command signature `cli_run(command, args, configPath)`. */
export interface CliRunRequest extends CliRunOptions {
  command: CliCommandId;
  args?: CliArgs;
}
