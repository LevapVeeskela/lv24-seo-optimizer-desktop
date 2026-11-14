export const STATS_PROVIDERS = [
  "gsc",
  "yandex_webmaster",
  "yandex_metrika",
  "bing",
  "crux",
  "psi",
] as const;

export type StatsProvider = (typeof STATS_PROVIDERS)[number];

export type ServiceStatus =
  | "ok"
  | "no_data"
  | "missing_token"
  | "not_configured"
  | "error";

export interface ServiceError {
  code: string;
  message: string;
}

export interface StatsService {
  provider: string;
  label?: string;
  configured: boolean;
  ready: boolean;
  status: ServiceStatus;
  metrics?: Record<string, number>;
  previous?: Record<string, number> | null;
  rows: number;
  data_age_days?: number;
  truncated?: boolean;
  limitations?: string[];
  warnings?: string[];
  error?: ServiceError | null;
  units?: Record<string, string>;
}

export interface StatsCoverage {
  configured: number;
  returned: number;
  failed: number;
  missing: number;
  complete: boolean;
}

export interface StatsPeriod {
  start: string;
  end: string;
}

export interface StatsData {
  period?: StatsPeriod;
  previous_period?: StatsPeriod | null;
  generated_at?: string;
  services?: StatsService[];
  coverage?: StatsCoverage;
  limitations?: string[];
  warnings?: string[];
}

export const PROVIDER_LABELS: Record<StatsProvider, string> = {
  gsc: "Google Search Console",
  yandex_webmaster: "Yandex Webmaster",
  yandex_metrika: "Yandex Metrika",
  bing: "Bing Webmaster",
  crux: "Chrome UX Report (CrUX)",
  psi: "PageSpeed Insights (PSI)",
};

export function serviceLabel(service: StatsService | undefined, provider: string): string {
  return service?.label ?? PROVIDER_LABELS[provider as StatsProvider] ?? provider;
}
