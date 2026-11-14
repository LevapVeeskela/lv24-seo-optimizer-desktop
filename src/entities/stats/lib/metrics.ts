import { formatNumber, formatPercent } from "@/shared/lib/format";
import type { MessageKey } from "@/shared/i18n";

export type DeltaDirection = "up" | "down" | "flat";
export type DeltaTone = "good" | "bad" | "neutral";
export type MetricUnit = "percent" | "percentage_points" | "position" | "absolute";

export interface MetricDelta {
  direction: DeltaDirection;
  tone: DeltaTone;
  /** Signed numeric text without a translated suffix. */
  text: string;
  unit: MetricUnit;
}

const LOWER_IS_BETTER = new Set([
  "position",
  "largest_contentful_paint",
  "interaction_to_next_paint",
  "cumulative_layout_shift",
  "first_contentful_paint",
  "total_blocking_time",
  "speed_index",
  "server_response_time",
]);

const HIGHER_IS_BETTER = new Set([
  "clicks",
  "impressions",
  "ctr",
  "sessions",
  "users",
  "visits",
  "pageviews",
  "performance",
  "seo",
  "queries",
  "pages",
]);

const METRIC_KEYS: Record<string, MessageKey> = {
  clicks: "metric.clicks",
  impressions: "metric.impressions",
  shows: "metric.shows",
  ctr: "metric.ctr",
  position: "metric.position",
  sessions: "metric.sessions",
  users: "metric.users",
  visits: "metric.visits",
  pageviews: "metric.pageviews",
  largest_contentful_paint: "metric.largest_contentful_paint",
  LCP: "metric.largest_contentful_paint",
  interaction_to_next_paint: "metric.interaction_to_next_paint",
  INP: "metric.interaction_to_next_paint",
  cumulative_layout_shift: "metric.cumulative_layout_shift",
  CLS: "metric.cumulative_layout_shift",
  performance: "metric.performance",
  seo: "metric.seo",
  first_contentful_paint: "metric.first_contentful_paint",
  FCP: "metric.first_contentful_paint",
  first_input_delay: "metric.first_input_delay",
  FID: "metric.first_input_delay",
  total_blocking_time: "metric.total_blocking_time",
  TBT: "metric.total_blocking_time",
  speed_index: "metric.speed_index",
  server_response_time: "metric.server_response_time",
  TTFB: "metric.server_response_time",
  queries: "metric.queries",
  pages: "metric.pages",
};

/**
 * PSI reports field/lab rows as uppercase Web Vitals labels as well as long
 * snake_case keys. Normalize the aliases for labels, formatting and tone.
 */
const METRIC_ALIASES: Record<string, string> = {
  LCP: "largest_contentful_paint",
  INP: "interaction_to_next_paint",
  CLS: "cumulative_layout_shift",
  FCP: "first_contentful_paint",
  FID: "first_input_delay",
  TBT: "total_blocking_time",
  TTFB: "server_response_time",
};

export function canonicalMetric(metric: string): string {
  return METRIC_ALIASES[metric] ?? metric;
}

/**
 * Lab metrics PSI reports without a `units` map. CrUX sends explicit units;
 * PSI does not, so the card would otherwise render bare numbers. CLS stays
 * unitless on purpose.
 */
const PSI_MILLISECOND_METRICS = new Set([
  "largest_contentful_paint",
  "LCP",
  "interaction_to_next_paint",
  "INP",
  "first_contentful_paint",
  "FCP",
  "first_input_delay",
  "FID",
  "total_blocking_time",
  "TBT",
  "speed_index",
  "server_response_time",
  "TTFB",
]);

export function metricLabelKey(metric: string): MessageKey | null {
  return METRIC_KEYS[metric] ?? METRIC_KEYS[canonicalMetric(metric)] ?? null;
}

/**
 * Effective unit for a metric. Explicit provider units win; PSI timing
 * metrics fall back to milliseconds, and everything else stays unitless.
 */
export function metricUnit(
  provider: string | undefined,
  metric: string,
  units?: Record<string, string>,
): string | undefined {
  const explicit = units?.[metric];
  if (explicit) {
    return explicit;
  }
  if (provider === "psi") {
    const canonical = canonicalMetric(metric);
    if (
      PSI_MILLISECOND_METRICS.has(metric) ||
      PSI_MILLISECOND_METRICS.has(canonical)
    ) {
      return "ms";
    }
  }
  return undefined;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatMetricValue(
  metric: string,
  value: number | null | undefined,
  locale: string,
  unit?: string,
): string {
  if (!finite(value)) {
    return "—";
  }
  const key = canonicalMetric(metric);
  if (key === "ctr") {
    return formatPercent(value, locale, 2);
  }
  if (key === "performance" || key === "seo") {
    return formatPercent(value, locale, 0);
  }
  if (unit === "ms") {
    return `${formatNumber(value, locale, 0)} ms`;
  }
  if (key === "position") {
    return formatNumber(value, locale, 1);
  }
  if (key === "cumulative_layout_shift") {
    return formatNumber(value, locale, 2);
  }
  if (unit === "score") {
    return formatNumber(value, locale, 2);
  }
  return formatNumber(value, locale, Number.isInteger(value) ? 0 : 2);
}

function directionOf(diff: number): DeltaDirection {
  if (diff > 0) {
    return "up";
  }
  if (diff < 0) {
    return "down";
  }
  return "flat";
}

function toneOf(metric: string, direction: DeltaDirection): DeltaTone {
  if (direction === "flat") {
    return "neutral";
  }
  if (LOWER_IS_BETTER.has(metric)) {
    return direction === "down" ? "good" : "bad";
  }
  if (HIGHER_IS_BETTER.has(metric)) {
    return direction === "up" ? "good" : "bad";
  }
  return "neutral";
}

function signed(value: number, digits: number, locale: string): string {
  const text = formatNumber(Math.abs(value), locale, digits);
  if (value > 0) {
    return `+${text}`;
  }
  if (value < 0) {
    return `-${text}`;
  }
  return text;
}

/**
 * Deltas are only produced when both values exist. A missing baseline stays
 * missing: the UI must not invent `previous = 0` or a percentage.
 */
export function formatDelta(
  metric: string,
  current: number | null | undefined,
  previous: number | null | undefined,
  locale: string,
): MetricDelta | null {
  if (!finite(current) || !finite(previous)) {
    return null;
  }
  const diff = current - previous;
  const direction = directionOf(diff);
  const key = canonicalMetric(metric);
  const tone = toneOf(key, direction);
  if (key === "ctr") {
    return {
      direction,
      tone,
      text: signed(diff * 100, 2, locale),
      unit: "percentage_points",
    };
  }
  if (key === "position") {
    return {
      direction,
      tone,
      text: signed(diff, 1, locale),
      unit: "position",
    };
  }
  if (previous === 0) {
    return {
      direction,
      tone,
      text: signed(diff, Number.isInteger(diff) ? 0 : 2, locale),
      unit: "absolute",
    };
  }
  return {
    direction,
    tone,
    text: signed((diff / Math.abs(previous)) * 100, 1, locale),
    unit: "percent",
  };
}


