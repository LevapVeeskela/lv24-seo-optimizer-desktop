import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import type { AppError } from "@/shared/lib/errors";

/** One flattened plan/result member for the summary tables. */
export interface IndexingDetail {
  key: string;
  value: string;
}

export type IndexingOutcomeStatus = "applied" | "skipped" | "unknown";

/**
 * Normalized two-phase write plan. The engine owns the payload; every field is
 * optional so an unexpected response renders an empty plan instead of throwing
 * in the panel. `confirmToken` is the only field the apply phase needs.
 */
export interface IndexingPlan {
  status: string | null;
  action: string | null;
  target: string | null;
  summary: string | null;
  planHash: string | null;
  confirmToken: string | null;
  ttlSeconds: number | null;
  details: IndexingDetail[];
  limitations: string[];
}

export interface IndexingOutcome {
  status: IndexingOutcomeStatus;
  reason: string | null;
  plan: IndexingPlan | null;
  details: IndexingDetail[];
  /** IndexNow reports `result.rows[0].submitted`; other actions leave it null. */
  submitted: number | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/** Deterministic one-line rendering; long nested values are bounded. */
function detailText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(detailText).join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 400 ? `${encoded.slice(0, 400)}…` : encoded;
  } catch {
    return String(value);
  }
}

/** Flatten one object into sorted key/value rows. */
export function indexingDetails(value: unknown): IndexingDetail[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => ({ key, value: detailText(item) }))
    .sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    );
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/**
 * The engine keeps coverage facts (`limitations`, `quota`, `total`, `truncated`)
 * in the envelope `meta`, while the plan/result payload is under `data`. Merge
 * them for the normalizers without changing the wire shape.
 */
export function withEnvelopeMeta(
  value: unknown,
  meta: Record<string, unknown>,
): unknown {
  return isRecord(value) ? { ...value, meta } : value;
}

export function normalizeIndexingPlan(value: unknown): IndexingPlan {
  const data = record(value);
  const plan = record(data.plan);
  const meta = record(data.meta);
  return {
    status: stringValue(data.status),
    action: stringValue(plan.action),
    target: stringValue(plan.target),
    summary: stringValue(plan.summary),
    planHash:
      stringValue(data.plan_hash) ??
      stringValue(data.planHash) ??
      stringValue(plan.plan_hash),
    confirmToken:
      stringValue(data.confirm_token) ?? stringValue(data.confirmToken),
    ttlSeconds:
      numberValue(data.ttl_seconds) ?? numberValue(data.ttlSeconds),
    details: indexingDetails(plan.payload),
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(plan.limitations),
      ...stringList(meta.limitations),
    ]),
  };
}

function normalizeStatus(value: string | null): IndexingOutcomeStatus {
  if (value === "applied") {
    return "applied";
  }
  if (value === "skipped") {
    return "skipped";
  }
  return "unknown";
}

/** Sum `result.rows[].submitted`; the engine may split one batch per row. */
function submittedCount(result: Record<string, unknown>): number | null {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const counts = rows
    .map((row) => (isRecord(row) ? numberValue(row.submitted) : null))
    .filter((value): value is number => value !== null);
  if (counts.length) {
    return counts.reduce((total, value) => total + value, 0);
  }
  return numberValue(result.submitted) ?? null;
}

/**
 * Normalized apply response. The engine echoes the reviewed plan; keep the
 * plan's fields when the echo is partial so the result card stays complete.
 */
export function normalizeIndexingOutcome(
  value: unknown,
  reviewed: IndexingPlan | null,
): IndexingOutcome {
  const data = record(value);
  const echoed = normalizeIndexingPlan(data);
  const result = isRecord(data.result) ? data.result : null;
  const plan: IndexingPlan = {
    ...echoed,
    action: echoed.action ?? reviewed?.action ?? null,
    target: echoed.target ?? reviewed?.target ?? null,
    summary: echoed.summary ?? reviewed?.summary ?? null,
    planHash: echoed.planHash ?? reviewed?.planHash ?? null,
    confirmToken: echoed.confirmToken ?? reviewed?.confirmToken ?? null,
    ttlSeconds: echoed.ttlSeconds ?? reviewed?.ttlSeconds ?? null,
    details: echoed.details.length ? echoed.details : (reviewed?.details ?? []),
    limitations: echoed.limitations.length
      ? echoed.limitations
      : (reviewed?.limitations ?? []),
  };
  return {
    status: normalizeStatus(stringValue(data.status)),
    reason: stringValue(data.reason),
    plan,
    details: result ? indexingDetails(result) : [],
    submitted: result ? submittedCount(result) : null,
  };
}

export type IndexingErrorHint = "auth" | "engine" | null;

/**
 * A missing Bing key and an engine without the 0.9.0 commands both need a
 * different action; the panel must not present either as a generic failure.
 */
export function indexingErrorHint(error: AppError | null): IndexingErrorHint {
  if (!error) {
    return null;
  }
  if (error.code === "AUTH_REQUIRED" || error.code === "MISSING_TOKEN") {
    return "auth";
  }
  if (error.code === "CLI_INVALID_JSON" || error.code === "INVALID_COMMAND") {
    return "engine";
  }
  return null;
}

/** One row of `bing sitemaps` (`GetFeeds`). Status is a free engine string. */
export interface BingSitemapRow {
  url: string;
  status: string | null;
  lastCrawled: string | null;
  urlCount: number | null;
}

export interface BingSitemapsReport {
  rows: BingSitemapRow[];
  limitations: string[];
}

/** One row of `bing issues` (`GetCrawlIssues`). `issues` is a bitmask. */
export interface BingIssueRow {
  url: string;
  httpCode: number | null;
  issues: number | null;
  inLinks: number | null;
}

export interface BingIssuesReport {
  rows: BingIssueRow[];
  limitations: string[];
}

/**
 * `GetUrlSubmissionQuota` returns remaining counts, never totals or usage.
 * Daily and monthly are kept separate because the monthly bucket can bind
 * first for a large site.
 */
export interface BingQuotaReport {
  dailyRemaining: number | null;
  monthlyRemaining: number | null;
  limitations: string[];
}

/** Plan/apply counts for `bing submit`; success means accepted, not indexed. */
export interface BingSubmitCounts {
  urls: number | null;
  batches: number | null;
  accepted: number | null;
  quota: BingQuotaReport;
}

function numberAt(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = numberValue(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function recordsFrom(
  value: unknown,
  keys: string[],
): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  const data = record(value);
  const result = record(data.result);
  for (const source of [data, result]) {
    for (const key of keys) {
      const candidate = source[key];
      if (Array.isArray(candidate)) {
        return candidate.filter(isRecord);
      }
    }
  }
  return [];
}

function reportLimitations(value: unknown): string[] {
  const data = record(value);
  const result = record(data.result);
  const meta = record(data.meta);
  return unique([
    ...stringList(data.limitations),
    ...stringList(result.limitations),
    ...stringList(meta.limitations),
  ]);
}

function field(
  source: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (source[key] !== null && source[key] !== undefined) {
      return source[key];
    }
  }
  return null;
}

/** Normalize `bing sitemaps` (`GetFeeds`): URL, status, last crawl, URL count. */
export function normalizeBingSitemaps(value: unknown): BingSitemapsReport {
  const rows = recordsFrom(value, [
    "sitemaps",
    "feeds",
    "items",
    "rows",
    "entries",
    "results",
  ])
    .map((source) => {
      const url = stringValue(
        field(source, ["url", "Url", "sitemap_url", "sitemapUrl", "loc"]),
      );
      const status = stringValue(field(source, ["status", "Status"]));
      const lastCrawled = stringValue(
        field(source, [
          "last_crawled",
          "lastCrawled",
          "LastCrawled",
          "last_crawl",
          "lastCrawl",
        ]),
      );
      const urlCount = numberValue(
        field(source, ["url_count", "urlCount", "UrlCount"]),
      );
      return {
        url: url ?? "",
        status,
        lastCrawled,
        urlCount,
      };
    })
    .filter(
      (row) =>
        row.url !== "" ||
        row.status !== null ||
        row.lastCrawled !== null ||
        row.urlCount !== null,
    );
  return { rows, limitations: reportLimitations(value) };
}

/** Normalize `bing issues` (`GetCrawlIssues`): URL, HTTP code, bitmask, in-links. */
export function normalizeBingIssues(value: unknown): BingIssuesReport {
  const rows = recordsFrom(value, [
    "issues",
    "crawl_issues",
    "crawlIssues",
    "items",
    "rows",
    "entries",
    "results",
  ])
    .map((source) => {
      const url = stringValue(
        field(source, ["url", "Url", "page", "affected_url", "affectedUrl"]),
      );
      const httpCode = numberValue(
        field(source, ["http_code", "httpCode", "HttpCode", "status_code"]),
      );
      const issues = numberValue(field(source, ["issues", "Issues", "issue"]));
      const inLinks = numberValue(
        field(source, ["in_links", "inLinks", "InLinks", "inlinks"]),
      );
      return {
        url: url ?? "",
        httpCode,
        issues,
        inLinks,
      };
    })
    .filter(
      (row) =>
        row.url !== "" ||
        row.httpCode !== null ||
        row.issues !== null ||
        row.inLinks !== null,
    );
  return { rows, limitations: reportLimitations(value) };
}

const REMAINING_KEYS = [
  "remaining",
  "remaining_count",
  "remainingCount",
  "left",
];
const DAILY_REMAINING_KEYS = [
  "daily_remaining",
  "dailyRemaining",
  "daily_remaining_count",
  "dailyRemainingCount",
  "remaining_daily",
  "remainingDaily",
  "daily_left",
  "dailyLeft",
  "daily_quota_remaining",
  "dailyQuotaRemaining",
];
const MONTHLY_REMAINING_KEYS = [
  "monthly_remaining",
  "monthlyRemaining",
  "monthly_remaining_count",
  "monthlyRemainingCount",
  "remaining_monthly",
  "remainingMonthly",
  "monthly_left",
  "monthlyLeft",
  "monthly_quota_remaining",
  "monthlyQuotaRemaining",
];

function remainingFor(
  source: Record<string, unknown>,
  period: "daily" | "monthly",
): number | null {
  const direct = numberAt(
    source,
    period === "daily" ? DAILY_REMAINING_KEYS : MONTHLY_REMAINING_KEYS,
  );
  if (direct !== null) {
    return direct;
  }
  for (const key of [period, `${period}_quota`, `${period}Quota`]) {
    const nested = record(source[key]);
    const value = numberAt(nested, REMAINING_KEYS);
    if (value !== null) {
      return value;
    }
  }
  for (const candidate of [
    source.quotas,
    source.items,
    source.rows,
    source.quota,
  ]) {
    if (!Array.isArray(candidate)) {
      continue;
    }
    for (const item of candidate) {
      const entry = record(item);
      const label = (
        stringValue(entry.period) ??
        stringValue(entry.window) ??
        stringValue(entry.kind) ??
        ""
      ).toLowerCase();
      if (label === period) {
        const value = numberAt(entry, REMAINING_KEYS);
        if (value !== null) {
          return value;
        }
      }
    }
  }
  return null;
}

/** Normalize `bing quota` (`GetUrlSubmissionQuota`): remaining counts only. */
export function normalizeBingQuota(value: unknown): BingQuotaReport {
  const data = record(value);
  const meta = record(data.meta);
  const sources = [
    record(data.quota),
    data,
    record(meta.quota),
    record(data.quota_after),
    record(data.quotaAfter),
    record(data.result),
  ].filter((source) => Object.keys(source).length > 0);
  const find = (period: "daily" | "monthly"): number | null => {
    for (const source of sources) {
      const value = remainingFor(source, period);
      if (value !== null) {
        return value;
      }
    }
    return null;
  };
  return {
    dailyRemaining: find("daily"),
    monthlyRemaining: find("monthly"),
    limitations: reportLimitations(value),
  };
}

/**
 * Plan/apply counts for `bing submit`. The engine reports the planned URL
 * count and batches, then the accepted count after apply. Quota is always the
 * remaining daily/monthly value.
 */
export function normalizeBingSubmitCounts(
  value: unknown,
  phase: "plan" | "result",
): BingSubmitCounts {
  const data = record(value);
  const meta = record(data.meta);
  const payload = record(record(data.plan).payload);
  const result = record(data.result);
  const source = phase === "plan" ? payload : result;
  const accepted =
    phase === "result"
      ? (submittedCount(result) ??
        numberAt(source, [
          "accepted",
          "submitted",
          "url_count",
          "urlCount",
        ]))
      : null;
  const urls =
    numberAt(source, [
      "url_count",
      "urlCount",
      "total_urls",
      "totalUrls",
      "urls_count",
      "urlsCount",
    ]) ??
    (Array.isArray(source.urls) ? source.urls.length : null) ??
    (phase === "result" ? accepted : null);
  const batches =
    numberAt(source, ["batches", "batch_count", "batchCount"]) ??
    (Array.isArray(source.batches) ? source.batches.length : null) ??
    (phase === "result" && Array.isArray(result.rows)
      ? result.rows.length
      : null);
  const quotaSource =
    source.quota ??
    source.quota_after ??
    source.quotaAfter ??
    payload.quota ??
    data.quota ??
    result.quota ??
    meta.quota;
  return {
    urls,
    batches,
    accepted,
    quota: normalizeBingQuota(quotaSource),
  };
}
