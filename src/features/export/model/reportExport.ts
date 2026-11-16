/**
 * Report export serializers (JSON + CSV). Pure: no IPC, no filesystem, no
 * locale-dependent number formatting, so the same report always produces the
 * same bytes.
 *
 * JSON payload (`lv24-seo.report/v1`):
 * `{schema, kind, property_id, period, generated_at, headline, sections,
 * limitations, warnings, meta:{complete,truncated,data_age_days,snapshot_hash}}`.
 * Sections and rows are copied verbatim from the engine report; the desktop
 * does not re-derive metrics.
 *
 * CSV is flat with exactly four columns: `section,metric,value,delta`.
 * - `section` is the report section key (`headline`, `traffic`, `issues`, …)
 *   or `limitations` / `warnings` for the text lists.
 * - `metric` is a dotted path inside the section:
 *   `headline` → `<metric>`; `traffic` → `<engine>.<field>`;
 *   `opportunities` → `<kind>:<query>:<page>.<field>`; `issues` →
 *   `<severity>.count`; `sources` → `<source>[:<kind>].rows`;
 *   `buckets` → `<reason>.count`; `examples` → `<reason>` with the URL in
 *   `value`; `limitations`/`warnings` → the text itself.
 * - `value` is the number or text; empty means the snapshot carried no value.
 * - `delta` is the engine's `abs_delta` for headline rows and empty elsewhere.
 */
import type {
  ReportMeta,
  ReportRow,
  ReportSection,
  WeeklyReport,
} from "@/entities/report/model/types";
import { reportLimitations, reportSections } from "@/entities/report/model/types";

export type ReportExportFormat = "json" | "csv";

export const REPORT_JSON_SCHEMA = "lv24-seo.report/v1";
export const REPORT_CSV_COLUMNS = ["section", "metric", "value", "delta"] as const;

export interface ReportCsvRow {
  section: string;
  metric: string;
  value: string;
  delta: string;
}

/** Numeric fields exported per known section; other fields stay JSON-only. */
const NUMERIC_FIELDS: Record<string, readonly string[]> = {
  traffic: ["rows", "clicks", "impressions", "ctr", "position"],
  opportunities: ["clicks", "impressions", "ctr", "position", "expected_clicks"],
  issues: ["count"],
  sources: ["rows"],
  buckets: ["count"],
};

/** Comparison-only fields; exporting them as separate rows would duplicate. */
const SKIP_FIELDS = new Set([
  "previous",
  "abs_delta",
  "pct_delta",
  "significant",
  "good",
]);

function text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function joined(row: ReportRow, keys: string[]): string {
  return keys
    .map((key) => (typeof row[key] === "string" ? (row[key] as string).trim() : ""))
    .filter(Boolean)
    .join(":");
}

function rowLabel(section: string, row: ReportRow): string {
  switch (section) {
    case "headline":
      return text(row.metric);
    case "traffic":
      return text(row.engine);
    case "opportunities":
      return joined(row, ["kind", "query", "page"]);
    case "issues":
      return text(row.severity);
    case "sources":
      return joined(row, ["source", "kind"]);
    case "buckets":
    case "examples":
      return text(row.reason);
    default:
      return "";
  }
}

function sectionRows(section: ReportSection): ReportCsvRow[] {
  const rows: ReportCsvRow[] = [];
  section.rows.forEach((row, index) => {
    const label = rowLabel(section.key, row) || `${section.key}-${index + 1}`;
    if (section.key === "headline") {
      rows.push({
        section: section.key,
        metric: label,
        value: text(row.current),
        delta: text(row.abs_delta),
      });
      return;
    }
    if (section.key === "examples") {
      rows.push({
        section: section.key,
        metric: label,
        value: text(row.url),
        delta: "",
      });
      return;
    }
    const fields = NUMERIC_FIELDS[section.key];
    const entries = fields
      ? fields.map((field) => [field, finite(row[field])] as const)
      : Object.entries(row)
          .filter(([field]) => !SKIP_FIELDS.has(field))
          .map(([field, value]) => [field, finite(value)] as const);
    const numeric = entries.filter(
      (entry): entry is readonly [string, number] => entry[1] !== null,
    );
    if (!numeric.length) {
      // Keep the row visible: an empty value is honest, a missing row is not.
      rows.push({ section: section.key, metric: label, value: "", delta: "" });
      return;
    }
    for (const [field, value] of numeric) {
      rows.push({
        section: section.key,
        metric: `${label}.${field}`,
        value: text(value),
        delta: "",
      });
    }
  });
  return rows;
}

/** Flat rows for the CSV export, in report section order. */
export function reportExportRows(
  report: WeeklyReport | null,
  meta: ReportMeta,
): ReportCsvRow[] {
  if (!report) {
    return [];
  }
  const rows: ReportCsvRow[] = [];
  for (const section of reportSections(report)) {
    rows.push(...sectionRows(section));
  }
  for (const limitation of reportLimitations(report, meta)) {
    rows.push({ section: "limitations", metric: limitation, value: "", delta: "" });
  }
  for (const warning of report.warnings ?? []) {
    if (typeof warning === "string" && warning.trim()) {
      rows.push({ section: "warnings", metric: warning, value: "", delta: "" });
    }
  }
  return rows;
}

/** Quote a CSV cell only when it needs it; `\n` is the row separator. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildReportCsv(
  report: WeeklyReport | null,
  meta: ReportMeta,
): string {
  const lines = [REPORT_CSV_COLUMNS.join(",")];
  for (const row of reportExportRows(report, meta)) {
    lines.push(
      [row.section, row.metric, row.value, row.delta].map(csvCell).join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function buildReportExportJson(
  report: WeeklyReport | null,
  meta: ReportMeta,
): string {
  const payload = {
    schema: REPORT_JSON_SCHEMA,
    kind: report?.kind ?? "weekly",
    property_id: report?.property_id ?? meta.property_id ?? null,
    period: report?.period ?? meta.period ?? null,
    generated_at: report?.generated_at ?? null,
    headline: report?.headline ?? null,
    sections: reportSections(report),
    limitations: reportLimitations(report, meta),
    warnings: (report?.warnings ?? []).filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    ),
    meta: {
      complete: typeof meta.complete === "boolean" ? meta.complete : null,
      truncated: typeof meta.truncated === "boolean" ? meta.truncated : null,
      data_age_days: finite(meta.data_age_days),
      snapshot_hash:
        typeof meta.snapshot_hash === "string" && meta.snapshot_hash.trim()
          ? meta.snapshot_hash
          : null,
    },
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/** `weekly-report-2026-11-07_2026-11-13.json`; no period → `weekly-report.json`. */
export function reportExportFilename(
  report: WeeklyReport | null,
  format: ReportExportFormat,
): string {
  const start = report?.period?.start?.trim();
  const end = report?.period?.end?.trim();
  const safe = (value: string) => value.replace(/[^0-9A-Za-z._-]+/g, "-");
  const period = start && end ? `-${safe(start)}_${safe(end)}` : "";
  return `weekly-report${period}.${format}`;
}

/** Join a filename under the shell's export root, keeping its separator style. */
export function joinExportPath(root: string, filename: string): string {
  const base = root.trim().replace(/[\\/]+$/, "");
  if (!base) {
    return "";
  }
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${filename}`;
}
