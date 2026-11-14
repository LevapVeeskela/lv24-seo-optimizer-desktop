import type { AppError } from "@/shared/lib/errors";
import type { Envelope } from "@/shared/cli";
import type { MessageKey, MessageParams } from "@/shared/i18n";

/**
 * The subset of `seo.toml` the desktop edits. Field names and defaults mirror
 * `lv24_seo.core.config.SeoConfig` in the pinned engine (0.4.0). Unknown keys
 * are deliberately not modelled: the engine rejects them, so inventing fields
 * here would only produce a file the engine refuses.
 */
export interface ProjectConfig {
  name: string;
  base_url: string;
  default_property: string;
}

export interface GscConfig {
  property: string;
  /** Reserved label; credentials live in the secret store. */
  auth: string;
}

export interface YandexWebmasterConfig {
  host_id: string;
}

export interface YandexMetrikaConfig {
  counter: string;
  /** Parsed by the engine but unused today. */
  goals: number[];
}

export interface BingConfig {
  site: string;
}

export interface CruxConfig {
  origin: string;
}

export type PsiStrategy = "mobile" | "desktop";

export interface PsiConfig {
  strategy: PsiStrategy;
  urls: string[];
}

/** `present` records whether the provider block existed in the source file. */
export type ProviderEntry<T> = T & { present: boolean };

export interface ProvidersConfig {
  gsc: ProviderEntry<GscConfig>;
  yandex_webmaster: ProviderEntry<YandexWebmasterConfig>;
  yandex_metrika: ProviderEntry<YandexMetrikaConfig>;
  bing: ProviderEntry<BingConfig>;
  crux: ProviderEntry<CruxConfig>;
  psi: ProviderEntry<PsiConfig>;
}

export interface ThresholdsConfig {
  clicks_pct: number;
  impressions_pct: number;
  position_abs: number;
}

export interface EmailConfig {
  enabled: boolean;
  to: string[];
  /** TOML key `from`; `from` is legal as a TypeScript property name. */
  from: string;
  only_on_change: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
}

export type TelegramSeverity = "critical" | "all";

export interface TelegramConfig {
  enabled: boolean;
  chat_id: string;
  /** Parsed by the engine but unused by delivery today. */
  severity: TelegramSeverity;
}

export type ReportLocale = "ru" | "en" | "zh";
export type WeekStart = "monday" | "sunday";

export interface ReportConfig {
  locale: ReportLocale;
  timezone: string;
  /** Reserved; report windows use the compare period. */
  week_start: WeekStart;
  thresholds: ThresholdsConfig;
  email: EmailConfig;
  telegram: TelegramConfig;
}

export interface CrawlConfig {
  max_urls: number;
  /** Reserved; the crawler is serial. */
  concurrency: number;
  respect_robots: boolean;
  user_agent: string;
}

export interface StorageConfig {
  data_dir: string;
  /** Reserved; no raw archives are written. */
  raw_retention_days: number;
}

export interface ConfigModel {
  project: ProjectConfig;
  providers: ProvidersConfig;
  report: ReportConfig;
  crawl: CrawlConfig;
  storage: StorageConfig;
}

export function defaultConfig(): ConfigModel {
  return {
    project: { name: "", base_url: "", default_property: "" },
    providers: {
      gsc: { present: false, property: "", auth: "keychain" },
      yandex_webmaster: { present: false, host_id: "" },
      yandex_metrika: { present: false, counter: "", goals: [] },
      bing: { present: false, site: "" },
      crux: { present: false, origin: "" },
      psi: { present: false, strategy: "mobile", urls: [] },
    },
    report: {
      locale: "ru",
      timezone: "Europe/Minsk",
      week_start: "monday",
      thresholds: { clicks_pct: 10, impressions_pct: 15, position_abs: 1.5 },
      email: {
        enabled: false,
        to: [],
        from: "",
        only_on_change: true,
        smtp_host: "",
        smtp_port: 587,
        smtp_user: "",
      },
      telegram: { enabled: false, chat_id: "", severity: "critical" },
    },
    crawl: {
      max_urls: 500,
      concurrency: 4,
      respect_robots: true,
      user_agent: "lv24-seo/0.1",
    },
    storage: { data_dir: "data", raw_retention_days: 90 },
  };
}

export function cloneConfig(model: ConfigModel): ConfigModel {
  return JSON.parse(JSON.stringify(model)) as ConfigModel;
}

/** Fields that exist in the schema but have no effect in engine 0.4.0. */
export const RESERVED_PATHS = {
  "providers.gsc.auth": "settings.reserved.gscAuth",
  "providers.yandex_metrika.goals": "settings.reserved.metrikaGoals",
  "report.week_start": "settings.reserved.weekStart",
  "report.telegram.severity": "settings.reserved.telegramSeverity",
  "crawl.concurrency": "settings.reserved.concurrency",
  "storage.raw_retention_days": "settings.reserved.rawRetention",
} as const satisfies Record<string, MessageKey>;

export type ReservedPath = keyof typeof RESERVED_PATHS;

export function isReservedPath(path: string): path is ReservedPath {
  return Object.prototype.hasOwnProperty.call(RESERVED_PATHS, path);
}

export interface ValidationIssue {
  path: string;
  /** English fallback; views prefer `messageKey` when present. */
  message: string;
  messageKey?: MessageKey;
  params?: MessageParams;
}

export interface ConfigValidation {
  valid: boolean;
  checkedAt: string;
  syntaxError: string | null;
  engineMessage: string | null;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  envelope: Envelope<unknown> | null;
}

export type DiffKind = "value" | "presence";

export interface ConfigDiffEntry {
  path: string;
  saved: unknown;
  draft: unknown;
  reserved: boolean;
  kind: DiffKind;
}

export interface ConfigReadResult {
  path: string;
  raw: string;
  dataDir: string | null;
  resolvedPath: string | null;
  config: Record<string, unknown> | null;
  syntaxError: string | null;
  envelope: Envelope<unknown> | null;
  warnings: string[];
  exitCode: number | null;
  stderr: string;
  engineError: AppError | null;
}

export interface ConfigValidateResult {
  path: string;
  valid: boolean;
  syntaxError: string | null;
  envelope: Envelope<unknown> | null;
  exitCode: number | null;
  stderr: string;
}

export interface ConfigPatch {
  /** Dotted path such as `report.locale`; `null` removes the key. */
  path: string;
  value: unknown;
}

export interface ConfigPatchOutcome {
  path: string;
  raw: string;
  backup: string | null;
  bytes: number;
  config: Record<string, unknown> | null;
  warnings: string[];
  engineError: AppError | null;
}

export interface ConfigWriteOutcome {
  path: string;
  backup: string | null;
  bytes: number;
}

export interface AuthProviderStatus {
  provider: string;
  secret: string;
  present: boolean;
  source: string;
  expires_at?: string | null;
}

export interface AuthStatusData {
  providers: AuthProviderStatus[];
  present: string[];
  missing: string[];
}

export interface DoctorCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface DoctorData {
  healthy: boolean;
  checks: DoctorCheck[];
}

export interface DoctorRun {
  ok: boolean;
  healthy: boolean;
  checks: DoctorCheck[];
  message: string | null;
  meta: Record<string, unknown>;
  warnings: string[];
  ranAt: string;
}

/** Providers the engine accepts for `auth status` / `auth set`. */
export const AUTH_PROVIDERS = [
  "gsc",
  "yandex",
  "bing",
  "crux",
  "psi",
  "smtp",
  "telegram",
] as const;

export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

export function authProviderForConfigProvider(
  provider: keyof ProvidersConfig | "smtp" | "telegram",
): AuthProvider {
  switch (provider) {
    case "yandex_webmaster":
    case "yandex_metrika":
      return "yandex";
    case "smtp":
      return "smtp";
    case "telegram":
      return "telegram";
    case "gsc":
    case "bing":
    case "crux":
    case "psi":
      return provider;
  }
}
