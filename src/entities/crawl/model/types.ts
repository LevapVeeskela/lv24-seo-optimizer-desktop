import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/**
 * The engine's crawl severity vocabulary plus `unknown` for a malformed row.
 * An unrecognized severity is kept and labelled honestly instead of being
 * promoted to a real severity or dropped from the evidence.
 */
export const CRAWL_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "unknown",
] as const;

export type CrawlSeverity = (typeof CRAWL_SEVERITIES)[number];

export interface CrawlIssue {
  rule_id: string;
  severity: CrawlSeverity;
  url: string;
  detail: Record<string, unknown>;
}

/** Counts stay nullable: a missing field is unknown, never zero. */
export interface CrawlSummary {
  start_url: string | null;
  site_url: string | null;
  urls: number | null;
  fetched: number | null;
  errors: number | null;
  blocked: number | null;
  issues: number | null;
  truncated: boolean | null;
  sitemap_urls: number | null;
  sitemap_truncated: boolean | null;
  request_count: number | null;
  request_budget: number | null;
}

export interface CrawlSitemapCoverage {
  counts: Record<string, number>;
  complete: boolean | null;
  truncated: boolean | null;
  limitations: string[];
}

/** Typed, defensive view of `crawl --json` `data`; the raw payload is kept for export. */
export interface CrawlResult {
  summary: CrawlSummary;
  issues: CrawlIssue[];
  errors: string[];
  blocked: string[];
  sitemap_coverage: CrawlSitemapCoverage | null;
}

export interface CrawlMeta {
  truncated?: boolean;
  limitations?: string[];
  [key: string]: unknown;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function crawlSeverity(value: unknown): CrawlSeverity {
  return typeof value === "string" &&
    (CRAWL_SEVERITIES as readonly string[]).includes(value)
    ? (value as CrawlSeverity)
    : "unknown";
}

function normalizeIssue(value: unknown): CrawlIssue | null {
  if (!isRecord(value)) {
    return null;
  }
  const ruleId = stringValue(value.rule_id);
  const url = stringValue(value.url);
  if (!ruleId || !url) {
    return null;
  }
  return {
    rule_id: ruleId,
    severity: crawlSeverity(value.severity),
    url,
    detail: isRecord(value.detail) ? value.detail : {},
  };
}

function normalizeCoverage(value: unknown): CrawlSitemapCoverage | null {
  if (!isRecord(value)) {
    return null;
  }
  const counts: Record<string, number> = {};
  if (isRecord(value.counts)) {
    for (const [key, raw] of Object.entries(value.counts)) {
      const count = numberValue(raw);
      if (count !== null) {
        counts[key] = count;
      }
    }
  }
  return {
    counts,
    complete: booleanValue(value.complete),
    truncated: booleanValue(value.truncated),
    limitations: stringList(value.limitations),
  };
}

/**
 * Map the CLI payload into the page model. Malformed issue rows are dropped
 * only when they cannot be identified (no rule or URL); everything else keeps
 * a value so the UI never invents a clean crawl.
 */
export function normalizeCrawlResult(value: unknown): CrawlResult {
  const data = isRecord(value) ? value : {};
  const summary = isRecord(data.summary) ? data.summary : {};
  const issues = Array.isArray(data.issues)
    ? data.issues
        .map(normalizeIssue)
        .filter((issue): issue is CrawlIssue => issue !== null)
    : [];

  return {
    summary: {
      start_url: stringValue(summary.start_url),
      site_url: stringValue(summary.site_url),
      urls: numberValue(summary.urls),
      fetched: numberValue(summary.fetched),
      errors: numberValue(summary.errors),
      blocked: numberValue(summary.blocked),
      issues: numberValue(summary.issues),
      truncated: booleanValue(summary.truncated),
      sitemap_urls: numberValue(summary.sitemap_urls),
      sitemap_truncated: booleanValue(summary.sitemap_truncated),
      request_count: numberValue(summary.request_count),
      request_budget: numberValue(summary.request_budget),
    },
    issues,
    errors: stringList(data.errors),
    blocked: stringList(data.blocked),
    sitemap_coverage: normalizeCoverage(data.sitemap_coverage),
  };
}

/** Limitations from the envelope and the sitemap coverage, de-duplicated. */
export function crawlLimitations(
  result: CrawlResult | null,
  meta: CrawlMeta,
): string[] {
  const merged = [
    ...(Array.isArray(meta.limitations) ? meta.limitations : []),
    ...(result?.sitemap_coverage?.limitations ?? []),
  ];
  return [
    ...new Set(
      merged.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      ),
    ),
  ];
}
