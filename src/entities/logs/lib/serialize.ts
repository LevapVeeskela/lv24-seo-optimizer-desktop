/**
 * Log-analysis serializers. Pure: no IPC, no filesystem, no locale-dependent
 * formatting, so the same analysis always produces the same bytes.
 *
 * JSON (`lv24-seo.logs/v1`) carries the full contract: totals, the daily rollup,
 * the crawl-waste summary with its by-bot split, limitations and warnings.
 *
 * CSV is the daily table only: `date,bot,status,hits,bytes,p95_ms`. The waste
 * summary stays in JSON because a flat table cannot express a share without
 * inventing a column the engine does not report.
 */
import {
  logsLimitations,
  type LogDailyRow,
  type LogsMeta,
  type LogsResult,
} from "../model/types";

export type LogsExportFormat = "json" | "csv";

export const LOGS_JSON_SCHEMA = "lv24-seo.logs/v1";
export const LOGS_CSV_COLUMNS = [
  "date",
  "bot",
  "status",
  "hits",
  "bytes",
  "p95_ms",
] as const;

function cell(value: string | number | null): string {
  return value === null ? "" : String(value);
}

/** Quote a CSV cell only when it needs it; `\n` is the row separator. */
export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function logsCsv(rows: readonly LogDailyRow[]): string {
  const lines = [LOGS_CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.date),
        csvCell(row.bot),
        csvCell(row.status),
        cell(row.hits),
        cell(row.bytes),
        cell(row.p95_ms),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export interface LogsJsonInput {
  file: string | null;
  bot: string | null;
  result: LogsResult;
  meta: LogsMeta;
  warnings: readonly string[];
  generatedAt?: string | null;
}

export function logsJson(input: LogsJsonInput): string {
  const payload = {
    schema: LOGS_JSON_SCHEMA,
    kind: "logs",
    file: input.file ?? input.meta.file ?? null,
    bot: input.bot ?? null,
    generated_at: input.generatedAt ?? null,
    totals: {
      total_lines: input.result.total_lines,
      parsed_lines: input.result.parsed_lines,
      skipped_lines: input.result.skipped_lines,
    },
    bot_daily: input.result.bot_daily,
    crawl_waste: input.result.crawl_waste,
    limitations: logsLimitations(input.meta),
    warnings: input.warnings.filter(
      (item): item is string => typeof item === "string" && item.trim() !== "",
    ),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function timestamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(
    11,
    13,
  )}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

function fileSlug(file: string | null): string {
  if (!file) {
    return "log";
  }
  const base = file.split(/[\\/]/).pop() ?? "log";
  const withoutExtension = base.replace(/\.[^.]+$/, "");
  const slug = withoutExtension
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "log";
}

/** `logs-access-20261116-102030.json`; the file name is never trusted verbatim. */
export function logsExportFilename(
  format: LogsExportFormat,
  file: string | null,
  now: Date = new Date(),
): string {
  return `logs-${fileSlug(file)}-${timestamp(now)}.${format}`;
}

/** Join a filename under the shell's export root, keeping its separator style. */
export function joinExportPath(directory: string, filename: string): string {
  const base = directory.trim().replace(/[\\/]+$/, "");
  if (!base) {
    return "";
  }
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${filename}`;
}
