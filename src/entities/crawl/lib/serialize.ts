import type { CrawlIssue, CrawlMeta } from "../model/types";

export const CRAWL_CSV_COLUMNS = ["severity", "rule_id", "url", "detail"] as const;

/** RFC 4180 cell: quote when needed and double embedded quotes. */
export function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function sortedRecord(detail: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(detail).sort()) {
    sorted[key] = detail[key];
  }
  return sorted;
}

/** One-line, key-sorted JSON so CSV diffs stay stable between runs. */
export function issueDetailJson(detail: Record<string, unknown>): string {
  try {
    return JSON.stringify(sortedRecord(detail));
  } catch {
    return "{}";
  }
}

export function crawlIssuesCsv(issues: readonly CrawlIssue[]): string {
  const rows = [
    CRAWL_CSV_COLUMNS.join(","),
    ...issues.map((issue) =>
      [
        csvCell(issue.severity),
        csvCell(issue.rule_id),
        csvCell(issue.url),
        csvCell(issueDetailJson(issue.detail)),
      ].join(","),
    ),
  ];
  return `${rows.join("\r\n")}\r\n`;
}

/**
 * The full `crawl --json` payload plus the envelope's honesty fields, so an
 * exported file can be diffed against the CLI output instead of a lossy view.
 */
export function crawlResultJson(
  raw: unknown,
  meta: CrawlMeta,
  warnings: readonly string[],
): string {
  return `${JSON.stringify(
    { ok: true, meta, warnings: [...warnings], data: raw },
    null,
    2,
  )}\n`;
}

function compactValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return String(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Readable table cell; the full value stays available in the title attribute. */
export function issueDetailText(
  detail: Record<string, unknown>,
  maxLength = 240,
): string {
  const entries = Object.entries(detail).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (entries.length === 0) {
    return "—";
  }
  const text = entries
    .map(([key, value]) => `${key}: ${compactValue(value)}`)
    .join(" · ");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
