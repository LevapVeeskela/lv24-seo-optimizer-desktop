/**
 * Tolerant view of the engine's `report_diff` payload.
 *
 * The engine (`lv24_seo.report.diff.diff_snapshots`) owns the semantics: a
 * metric is compared only when both snapshots carry it, and `comparable` is
 * false when the windows are not like-for-like. The desktop never recomputes a
 * delta and never turns a missing value into zero; it only narrows the JSON so
 * a malformed row cannot crash the page.
 */
import type { AppError } from "@/shared/lib/errors";

export interface ReportDiffIdentity {
  property_id: string | null;
  /** Engine period label, `"<start>..<end>"`. */
  period: string | null;
  headline: string | null;
}

export interface ReportDiffMetricRow {
  metric: string;
  base: number;
  head: number;
  abs_delta: number;
  pct_delta: number | null;
}

export interface ReportDiffIssueRow {
  severity: string;
  base: number;
  head: number;
  delta: number;
}

export interface ReportDiffOpportunity {
  kind: string;
  query: string;
  page: string;
}

export interface ReportDiffOpportunities {
  added: ReportDiffOpportunity[];
  resolved: ReportDiffOpportunity[];
  unchanged: number;
}

export interface ReportDiffLimitationsChanged {
  added: string[];
  lifted: string[];
}

export interface ReportDiff {
  base: ReportDiffIdentity;
  head: ReportDiffIdentity;
  comparable: boolean;
  headline: ReportDiffMetricRow[];
  unknown_metrics: string[];
  issues: ReportDiffIssueRow[];
  opportunities: ReportDiffOpportunities;
  limitations_changed: ReportDiffLimitationsChanged;
  limitations: string[];
}

/** `meta` of the `report_diff` envelope, as emitted by the engine. */
export interface ReportDiffMeta {
  property_id?: string;
  kind?: string;
  base_period?: string;
  head_period?: string;
  available_periods?: string[];
  complete?: boolean;
  truncated?: boolean;
  limitations?: string[];
  [key: string]: unknown;
}

export type DiffUnavailableReason = "not_enough_snapshots" | "no_store";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

function identity(value: unknown): ReportDiffIdentity {
  const source = record(value) ?? {};
  return {
    property_id: text(source.property_id),
    period: text(source.period),
    headline: text(source.headline),
  };
}

function metrics(value: unknown): ReportDiffMetricRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: ReportDiffMetricRow[] = [];
  for (const item of value) {
    const row = record(item);
    const metric = text(row?.metric);
    const base = finite(row?.base);
    const head = finite(row?.head);
    const absDelta = finite(row?.abs_delta);
    if (!row || !metric || base === null || head === null || absDelta === null) {
      continue;
    }
    rows.push({
      metric,
      base,
      head,
      abs_delta: absDelta,
      pct_delta: finite(row.pct_delta),
    });
  }
  return rows;
}

function issues(value: unknown): ReportDiffIssueRow[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: ReportDiffIssueRow[] = [];
  for (const item of value) {
    const row = record(item);
    const severity = text(row?.severity);
    const base = finite(row?.base);
    const head = finite(row?.head);
    const delta = finite(row?.delta);
    if (!row || !severity || base === null || head === null || delta === null) {
      continue;
    }
    rows.push({ severity, base, head, delta });
  }
  return rows;
}

function opportunities(value: unknown): ReportDiffOpportunity[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: ReportDiffOpportunity[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row) {
      continue;
    }
    rows.push({
      kind: text(row.kind) ?? "",
      query: text(row.query) ?? "",
      page: text(row.page) ?? "",
    });
  }
  return rows;
}

/**
 * Narrow `report_diff` data. Returns null when the payload has neither
 * snapshot identity: rendering an "empty diff" for a broken payload would
 * claim the two reports are identical.
 */
export function parseReportDiff(value: unknown): ReportDiff | null {
  const source = record(value);
  if (!source || !record(source.base) || !record(source.head)) {
    return null;
  }
  const changed = record(source.limitations_changed) ?? {};
  const found = record(source.opportunities) ?? {};
  return {
    base: identity(source.base),
    head: identity(source.head),
    comparable: source.comparable === true,
    headline: metrics(source.headline),
    unknown_metrics: strings(source.unknown_metrics),
    issues: issues(source.issues),
    opportunities: {
      added: opportunities(found.added),
      resolved: opportunities(found.resolved),
      unchanged: finite(found.unchanged) ?? 0,
    },
    limitations_changed: {
      added: strings(changed.added),
      lifted: strings(changed.lifted),
    },
    limitations: strings(source.limitations),
  };
}

/** Severity rows whose count actually moved; unchanged rows add noise. */
export function diffChangedIssues(diff: ReportDiff): ReportDiffIssueRow[] {
  return diff.issues.filter((row) => row.delta !== 0);
}

/** True when the diff has at least one observable change to show. */
export function diffHasChanges(diff: ReportDiff): boolean {
  return (
    diff.headline.some((row) => row.abs_delta !== 0) ||
    diffChangedIssues(diff).length > 0 ||
    diff.opportunities.added.length > 0 ||
    diff.opportunities.resolved.length > 0 ||
    diff.limitations_changed.added.length > 0 ||
    diff.limitations_changed.lifted.length > 0
  );
}

/** `"2026-11-07..2026-11-13"` -> `"2026-11-07 – 2026-11-13"`. */
export function diffPeriodLabel(identity: ReportDiffIdentity): string | null {
  if (!identity.period) {
    return null;
  }
  const [start, end] = identity.period.split("..");
  if (!start || !end) {
    return identity.period;
  }
  return `${start} – ${end}`;
}

/**
 * Classify the two expected "cannot compare yet" failures so the page shows an
 * empty state with a next step instead of a red error. Everything else stays a
 * real error with the engine's own message.
 */
export function diffUnavailableReason(
  error: Pick<AppError, "code" | "message"> | { code?: string; message?: string },
): DiffUnavailableReason | null {
  // `report_diff` raises CONFIG_INVALID without a store and INVALID_INPUT only
  // when fewer than two snapshots exist (services.report_diff). The message
  // check keeps a future INVALID_INPUT for another reason a real error.
  if (error.code === "CONFIG_INVALID") {
    return "no_store";
  }
  if (error.code === "INVALID_INPUT" && /snapshot/i.test(error.message ?? "")) {
    return "not_enough_snapshots";
  }
  return null;
}
