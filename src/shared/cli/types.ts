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
