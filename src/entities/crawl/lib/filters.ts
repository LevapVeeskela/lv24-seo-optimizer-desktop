import type { CrawlIssue, CrawlSeverity } from "../model/types";
import { CRAWL_SEVERITIES } from "../model/types";

export interface CrawlFilters {
  /** `all` keeps every severity; otherwise an exact severity value. */
  severity: CrawlSeverity | "all";
  /** `all` keeps every rule; otherwise an exact `rule_id`. */
  rule: string;
  /** Free text matched against rule, severity, URL and the detail payload. */
  query: string;
}

export const CRAWL_FILTERS_DEFAULT: CrawlFilters = {
  severity: "all",
  rule: "all",
  query: "",
};

export interface CrawlFacet<T> {
  value: T;
  count: number;
}

export interface CrawlIssueFacets {
  severities: CrawlFacet<CrawlSeverity>[];
  rules: CrawlFacet<string>[];
}

const SEVERITY_RANK: Record<CrawlSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable order: severity first, then rule, then URL. */
export function sortCrawlIssues(issues: readonly CrawlIssue[]): CrawlIssue[] {
  return [...issues].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      compareText(a.rule_id, b.rule_id) ||
      compareText(a.url, b.url),
  );
}

function detailHaystack(detail: Record<string, unknown>): string {
  try {
    return JSON.stringify(detail) ?? "";
  } catch {
    return "";
  }
}

export function filterCrawlIssues(
  issues: readonly CrawlIssue[],
  filters: CrawlFilters,
): CrawlIssue[] {
  const query = filters.query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (filters.severity !== "all" && issue.severity !== filters.severity) {
      return false;
    }
    if (filters.rule !== "all" && issue.rule_id !== filters.rule) {
      return false;
    }
    if (!query) {
      return true;
    }
    return [
      issue.rule_id,
      issue.severity,
      issue.url,
      detailHaystack(issue.detail),
    ].some((value) => value.toLowerCase().includes(query));
  });
}

/** Present values only, so a filter never offers an option with zero rows. */
export function crawlIssueFacets(
  issues: readonly CrawlIssue[],
): CrawlIssueFacets {
  const severityCounts = new Map<CrawlSeverity, number>();
  const ruleCounts = new Map<string, number>();
  for (const issue of issues) {
    severityCounts.set(
      issue.severity,
      (severityCounts.get(issue.severity) ?? 0) + 1,
    );
    ruleCounts.set(issue.rule_id, (ruleCounts.get(issue.rule_id) ?? 0) + 1);
  }
  return {
    severities: CRAWL_SEVERITIES.filter((severity) =>
      severityCounts.has(severity),
    ).map((severity) => ({
      value: severity,
      count: severityCounts.get(severity) ?? 0,
    })),
    rules: [...ruleCounts.keys()]
      .sort(compareText)
      .map((rule) => ({ value: rule, count: ruleCounts.get(rule) ?? 0 })),
  };
}

/** A selected value that no longer exists must not hide every row. */
export function effectiveCrawlFilters(
  filters: CrawlFilters,
  facets: CrawlIssueFacets,
): CrawlFilters {
  const severity =
    filters.severity !== "all" &&
    facets.severities.some((item) => item.value === filters.severity)
      ? filters.severity
      : "all";
  const rule =
    filters.rule !== "all" && facets.rules.some((item) => item.value === filters.rule)
      ? filters.rule
      : "all";
  return { ...filters, severity, rule };
}
