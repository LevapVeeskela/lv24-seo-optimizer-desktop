export interface ReportPeriod {
  start: string;
  end: string;
}

export interface ReportRow {
  [key: string]: unknown;
}

export interface ReportSection {
  key: string;
  title: string;
  summary: string;
  rows: ReportRow[];
  notes: string[];
  /** Optional discriminator added by the 0.4.0 attributed change digest. */
  kind?: string;
  /** Bounded-response metadata carried by the digest section. */
  total?: number | null;
  truncated?: boolean | null;
  data_age?: string | null;
  limitations?: string[];
}

export interface WeeklyReport {
  kind?: string;
  property_id?: string;
  period?: ReportPeriod;
  generated_at?: string;
  headline?: string;
  sections?: ReportSection[];
  limitations?: string[];
  warnings?: string[];
}

export interface ReportArtifacts {
  json?: string;
  html?: string;
  [key: string]: unknown;
}

export interface ReportMeta {
  sent?: boolean;
  property_id?: string;
  period?: ReportPeriod;
  previous_period?: ReportPeriod;
  sources?: string[];
  sources_failed?: string[];
  sources_missing?: string[];
  sources_incomplete?: string[];
  complete?: boolean;
  data_age_days?: number;
  locale?: string;
  truncated?: boolean;
  limitations?: string[];
  snapshot_hash?: string;
  artifacts?: ReportArtifacts;
  [key: string]: unknown;
}

export function reportSections(report: WeeklyReport | null): ReportSection[] {
  if (!report || !Array.isArray(report.sections)) {
    return [];
  }
  return report.sections.filter(
    (section): section is ReportSection =>
      typeof section === "object" &&
      section !== null &&
      typeof section.key === "string" &&
      typeof section.title === "string",
  );
}

export function reportLimitations(report: WeeklyReport | null, meta: ReportMeta): string[] {
  const merged = [...(report?.limitations ?? []), ...(meta.limitations ?? [])];
  return [...new Set(merged.filter((item) => typeof item === "string" && item.trim()))];
}

export function reportHtmlPath(meta: ReportMeta): string | null {
  const path = meta.artifacts?.html;
  return typeof path === "string" && path.trim() ? path : null;
}
