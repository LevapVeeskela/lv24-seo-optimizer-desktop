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
  ctr: "metric.ctr",
  position: "metric.position",
  sessions: "metric.sessions",
  users: "metric.users",
  visits: "metric.visits",
  pageviews: "metric.pageviews",
  largest_contentful_paint: "metric.largest_contentful_paint",
  interaction_to_next_paint: "metric.interaction_to_next_paint",
  cumulative_layout_shift: "metric.cumulative_layout_shift",
  performance: "metric.performance",
  seo: "metric.seo",
  first_contentful_paint: "metric.first_contentful_paint",
  total_blocking_time: "metric.total_blocking_time",
  speed_index: "metric.speed_index",
  server_response_time: "metric.server_response_time",
  queries: "metric.queries",
  pages: "metric.pages",
};

export function metricLabelKey(metric: string): MessageKey | null {
  return METRIC_KEYS[metric] ?? null;
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
  if (metric === "ctr") {
    return formatPercent(value, locale, 2);
  }
  if (metric === "performance" || metric === "seo") {
    return formatPercent(value, locale, 0);
  }
  if (unit === "ms") {
    return `${formatNumber(value, locale, 0)} ms`;
  }
  if (metric === "position") {
    return formatNumber(value, locale, 1);
  }
  if (metric === "cumulative_layout_shift") {
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
  const tone = toneOf(metric, direction);
  if (metric === "ctr") {
    return {
      direction,
      tone,
      text: signed(diff * 100, 2, locale),
      unit: "percentage_points",
    };
  }
  if (metric === "position") {
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


