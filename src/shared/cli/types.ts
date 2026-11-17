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
  "sitemap_submit",
  "indexnow_submit",
  "bing_submit",
  "bing_sitemaps",
  "bing_issues",
  "bing_quota",
  "gsc_inspect",
  "gsc_sitemaps",
  "yandex_indexing",
  "yandex_sitemaps",
  "yandex_queue",
  "bing_pages",
  "bing_traffic",
  "bing_crawl",
  "bing_urlinfo",
  "bing_joins",
  "metrika_pages",
  "metrika_goals",
  "metrika_devices",
  "metrika_countries",
  "metrika_engagement",
  "metrika_bytime",
  "cwv_audits",
  "cwv_history",
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
  /** `bing_submit` only: absolute http(s) URLs, one `--url` per entry. */
  urls?: string[];
  /** `bing_submit` only: read the URL list from the sitemap. */
  fromSitemap?: boolean;
  /** `indexnow_submit` and `bing_submit`: optional absolute sitemap URL. */
  sitemapUrl?: string;
  /** `sitemap_submit` and `bing_submit` only: must be `bing`. */
  provider?: "bing";
  /** `tasks_add` only: rule/finding id that produced the task. */
  rule?: string;
  /** `tasks_add` only: evidence object, JSON-encoded (16 KiB cap). */
  payload?: Record<string, unknown>;
  /**
   * `tasks_update`: positive task id, sent as a decimal string.
   * `yandex_sitemaps`/`yandex_queue`: provider sitemap or recrawl task id.
   */
  id?: string;
  /** `backup_create` only: replace a same-second archive. */
  force?: boolean;
  /**
   * `backup_restore` and the indexing apply phases, plus the indexing plan
   * phases (the engine requires the opt-in to mint a token), and
   * `schedule_install`. The plan/preview phases omit `confirm`, not this flag.
   */
  allowWrite?: boolean;
  /** Apply-phase `confirmToken` from the plan; never set on a plan call. */
  confirm?: string;
  /** `portfolio_list` only: absolute projects directory from `pick_directory`. */
  root?: string;
  /** `gsc_inspect` only: BCP-47 language for localized states. */
  language?: string;
  /** `gsc_sitemaps` only: sitemap index URL whose summary is also read. */
  sitemapIndex?: string;
  /** `yandex_indexing`/`yandex_queue` only: first day, YYYY-MM-DD. */
  dateFrom?: string;
  /** `yandex_indexing`/`yandex_queue` only: last day, YYYY-MM-DD. */
  dateTo?: string;
  /** `yandex_sitemaps` only: list the children of one sitemap index. */
  parentId?: string;
  /** `yandex_queue` only: first provider row. */
  offset?: number;
  /** `bing_joins` only: search query; lists the pages that received impressions. */
  query?: string;
  /** `bing_joins` only: page URL or `domain:<host>`; lists its queries. */
  page?: string;
  /** `metrika_bytime` only: day, week or month. */
  group?: "day" | "week" | "month";
  /** `cwv_audits` only: mobile or desktop. */
  strategy?: "mobile" | "desktop";
  /** `cwv_audits` only: Lighthouse categories; one `--category` per entry. */
  category?: Array<
    "performance" | "seo" | "accessibility" | "best-practices"
  >;
  /** `cwv_history` only: phone, desktop or tablet. */
  device?: "phone" | "desktop" | "tablet";
  /** `cwv_history` only: weekly collection periods (1..40). */
  weeks?: number;
  /** `cwv_history` only: origin URL (mutually exclusive with `url`). */
  origin?: string;
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
