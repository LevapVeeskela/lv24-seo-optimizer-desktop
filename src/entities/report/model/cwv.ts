import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import type { ReportSection, WeeklyReport } from "./types";

export type CwvUnit = "ms" | "score";

export interface CwvRow {
  /** URL template the row aggregates, e.g. `/blog/{id}`. */
  template: string;
  /** `phone` / `desktop` / `tablet`, or the raw value when unrecognized. */
  device: string;
  /** Canonical metric (`lcp`, `cls`, …) or the engine's raw name. */
  metric: string | null;
  /** 75th percentile: milliseconds for timings, 0..1 for layout shift. */
  p75: number;
  unit: CwvUnit | null;
  /** `null` when the engine did not classify the row. */
  regression: boolean | null;
  /** Signed p75 movement when the engine reports one. */
  delta: number | null;
  /** Relative movement when only a percentage is reported. */
  deltaPct: number | null;
}

export interface ReportCwv {
  section: ReportSection;
  /** Flattened metric rows for the table. */
  rows: CwvRow[];
  /** Distinct template+device groups actually rendered. */
  templates: number;
  /** Template count reported by the engine (the section's `total`). */
  total: number;
  truncated: boolean;
  dataAge: string | null;
  limitations: string[];
  /** Template rows the UI could not turn into at least one metric row. */
  skipped: number;
}

/** Layout shift is a unitless score; every other CrUX metric is milliseconds. */
const SCORE_METRICS = new Set(["cumulative_layout_shift", "cls"]);

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function cwvDevice(value: unknown): string {
  const raw = stringValue(value)?.trim().toLowerCase();
  if (!raw) {
    return "unknown";
  }
  if (raw === "mobile" || raw === "smartphone") {
    return "phone";
  }
  return raw;
}

function cwvUnit(value: unknown, metric: string | null): CwvUnit | null {
  if (value === "ms" || value === "score") {
    return value;
  }
  if (!metric) {
    return null;
  }
  return SCORE_METRICS.has(metric) ? "score" : "ms";
}

function metricName(value: unknown): string | null {
  const text = stringValue(value)?.trim();
  return text ? text.toLowerCase() : null;
}

/**
 * A flat CWV row (the documented `template/device/p75/regression` shape) or
 * `null` when the template or p75 is missing. Rows without those two fields
 * are counted as skipped by the caller, never guessed.
 */
export function mapCwvRow(raw: unknown): CwvRow | null {
  if (!isRecord(raw)) {
    return null;
  }
  const template =
    stringValue(raw.template)?.trim() ??
    stringValue(raw.pattern)?.trim() ??
    stringValue(raw.group)?.trim() ??
    "";
  const p75 =
    numberValue(raw.p75) ??
    numberValue(raw.value) ??
    numberValue(raw.percentile_75);
  if (!template || p75 === null) {
    return null;
  }
  const metric = metricName(raw.metric ?? raw.metric_name);
  const regression = raw.regression;
  const delta =
    numberValue(raw.delta) ??
    numberValue(raw.p75_delta) ??
    numberValue(raw.change);
  return {
    template,
    device: cwvDevice(raw.device ?? raw.form_factor ?? raw.formFactor),
    metric,
    p75,
    unit: cwvUnit(raw.unit, metric),
    regression:
      typeof regression === "boolean"
        ? regression
        : typeof regression === "number" && Number.isFinite(regression)
          ? regression > 0
          : delta !== null && delta <= 0
            ? false
            : null,
    delta:
      typeof regression === "number" && Number.isFinite(regression)
        ? regression
        : delta,
    deltaPct: numberValue(raw.delta_pct) ?? numberValue(raw.regression_pct),
  };
}

/**
 * Expand one engine row into table rows. The 0.5.0 report emits one row per
 * template+device with a bounded `metrics` array; a flat metric row is still
 * accepted so the card keeps working with the documented shape.
 */
export function mapCwvRows(raw: unknown): CwvRow[] {
  if (!isRecord(raw)) {
    return [];
  }
  const metrics = Array.isArray(raw.metrics) ? raw.metrics : null;
  if (!metrics) {
    const flat = mapCwvRow(raw);
    return flat ? [flat] : [];
  }
  const template =
    stringValue(raw.template)?.trim() ??
    stringValue(raw.pattern)?.trim() ??
    "";
  if (!template) {
    return [];
  }
  const device = cwvDevice(raw.device ?? raw.form_factor ?? raw.formFactor);
  const parentRegressed =
    typeof raw.regressed === "boolean" ? raw.regressed : null;
  const regressionMetric =
    stringValue(raw.regression_metric)?.trim().toLowerCase() ?? null;
  const regressionPct = numberValue(raw.regression_pct);
  const rows: CwvRow[] = [];
  for (const item of metrics) {
    if (!isRecord(item)) {
      continue;
    }
    const metric = metricName(item.metric ?? item.name);
    const p75 =
      numberValue(item.p75) ??
      numberValue(item.value) ??
      numberValue(item.percentile);
    if (p75 === null) {
      continue;
    }
    const metricRegressed =
      typeof item.regressed === "boolean" ? item.regressed : null;
    const compared =
      numberValue(item.compared) ?? numberValue(raw.compared);
    let regression =
      metricRegressed ??
      (parentRegressed === null
        ? null
        : parentRegressed &&
          (regressionMetric === null || regressionMetric === metric));
    // `regressed: false` without a single compared sample is "no baseline",
    // not proof that the metric is stable.
    if (regression === false && compared === 0) {
      regression = null;
    }
    rows.push({
      template,
      device,
      metric,
      p75,
      unit: cwvUnit(item.unit, metric),
      regression,
      delta: numberValue(item.delta),
      deltaPct:
        numberValue(item.delta_pct) ??
        (regressionMetric !== null && regressionMetric === metric
          ? regressionPct
          : null),
    });
  }
  return rows;
}

/**
 * `kind: "cwv"` is the 0.5.0 contract. A section named `cwv` without the
 * discriminator is accepted too, matching the digest parser, so an engine that
 * predates the discriminator still gets the compact card.
 */
export function isCwvSection(value: unknown): value is ReportSection {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.title !== "string"
  ) {
    return false;
  }
  return value.kind === "cwv" || (value.kind === undefined && value.key === "cwv");
}

/** The first section explicitly marked `kind: "cwv"`, or `null`. */
export function reportCwvSection(
  report: WeeklyReport | null,
): ReportSection | null {
  if (!report || !Array.isArray(report.sections)) {
    return null;
  }
  return report.sections.find(isCwvSection) ?? null;
}

/** Engine limitation codes that belong to the CWV card. */
export function isCwvLimitation(value: string): boolean {
  return value.trim().startsWith("cwv_");
}

/**
 * `null` when the section is absent or not marked as CWV. `extraLimitations`
 * carries the CWV-specific report-level caveats; the engine stores them on the
 * report, not inside the section.
 */
export function parseCwv(
  section: ReportSection | null,
  extraLimitations: readonly string[] = [],
): ReportCwv | null {
  if (!section || !isCwvSection(section)) {
    return null;
  }
  const rows: CwvRow[] = [];
  let skipped = 0;
  for (const raw of Array.isArray(section.rows) ? section.rows : []) {
    const expanded = mapCwvRows(raw);
    if (expanded.length) {
      rows.push(...expanded);
    } else {
      skipped += 1;
    }
  }
  const templates = new Set(
    rows.map((row) => `${row.template}\u0000${row.device}`),
  ).size;
  return {
    section,
    rows,
    templates,
    total: numberValue(section.total) ?? templates,
    truncated: section.truncated === true,
    dataAge: stringValue(section.data_age),
    limitations: [
      ...new Set([
        ...stringList(section.limitations),
        ...stringList(section.notes),
        ...extraLimitations.filter(
          (item): item is string => typeof item === "string" && item.trim() !== "",
        ),
      ]),
    ],
    skipped,
  };
}

/** p75 with its unit; an unknown unit stays a plain number. */
export function formatCwvP75(row: CwvRow, locale: string): string {
  if (row.unit === "score") {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 3,
      minimumFractionDigits: 0,
    }).format(row.p75);
  }
  if (row.unit === "ms") {
    return `${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
    }).format(row.p75)} ms`;
  }
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(row.p75);
}

/** Signed delta with the row's unit, or the relative percentage. */
export function formatCwvDelta(row: CwvRow, locale: string): string | null {
  if (row.delta !== null) {
    const sign = row.delta > 0 ? "+" : "";
    if (row.unit === "score") {
      return `${sign}${new Intl.NumberFormat(locale, {
        maximumFractionDigits: 3,
      }).format(row.delta)}`;
    }
    if (row.unit === "ms") {
      return `${sign}${new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
      }).format(row.delta)} ms`;
    }
    return `${sign}${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 2,
    }).format(row.delta)}`;
  }
  if (row.deltaPct !== null) {
    const sign = row.deltaPct > 0 ? "+" : "";
    return `${sign}${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 1,
    }).format(row.deltaPct)}%`;
  }
  return null;
}
