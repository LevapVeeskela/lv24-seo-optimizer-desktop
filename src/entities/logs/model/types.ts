import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/**
 * Bot classes produced by the engine's User-Agent triage (`logs analyze`).
 * The classification is UA-only: a spoofed UA is not a verified crawler, so the
 * screen shows the engine's limitation verbatim instead of claiming coverage.
 */
export const LOG_BOTS = ["googlebot", "yandexbot", "bingbot", "other"] as const;

export type LogBot = (typeof LOG_BOTS)[number];

/** Status classes used by the engine rollup. */
export const LOG_STATUS_CLASSES = ["2xx", "3xx", "4xx", "5xx", "other"] as const;

export type LogStatusClass = (typeof LOG_STATUS_CLASSES)[number];

/** An unrecognized value is kept as `unknown` instead of being promoted. */
export type LogBotValue = LogBot | "unknown";
export type LogStatusValue = LogStatusClass | "unknown";

/** One `(date, bot, status class)` rollup row; counts stay nullable when absent. */
export interface LogDailyRow {
  date: string;
  bot: LogBotValue;
  status: LogStatusValue;
  hits: number | null;
  bytes: number | null;
  p95_ms: number | null;
}

export interface WasteByBot {
  bot: LogBotValue;
  hits: number | null;
  bytes: number | null;
  share: number | null;
  total_hits: number | null;
}

/**
 * Wasted crawl volume. `share` is reproducible from `hits / total_hits`;
 * `by_bot` always covers every parsed request even when the run is bot-filtered.
 */
export interface CrawlWaste {
  hits: number | null;
  bytes: number | null;
  share: number | null;
  total_hits: number | null;
  total_bytes: number | null;
  by_bot: WasteByBot[];
}

export interface LogsResult {
  total_lines: number | null;
  parsed_lines: number | null;
  skipped_lines: number | null;
  bot_daily: LogDailyRow[];
  crawl_waste: CrawlWaste;
}

export interface LogsMeta {
  file?: string;
  size_bytes?: number;
  bot?: string | null;
  truncated?: boolean;
  total?: number;
  data_age_days?: number | null;
  limitations?: string[];
  [key: string]: unknown;
}

export function logBotValue(value: unknown): LogBotValue {
  return typeof value === "string" &&
    (LOG_BOTS as readonly string[]).includes(value)
    ? (value as LogBot)
    : "unknown";
}

export function logStatusValue(value: unknown): LogStatusValue {
  return typeof value === "string" &&
    (LOG_STATUS_CLASSES as readonly string[]).includes(value)
    ? (value as LogStatusClass)
    : "unknown";
}

function normalizeRow(value: unknown): LogDailyRow | null {
  if (!isRecord(value)) {
    return null;
  }
  const date = stringValue(value.date);
  if (!date) {
    // Without a date the row cannot be placed on the timeline; keeping it
    // would silently mix an unlabelled bucket into the daily rollup.
    return null;
  }
  return {
    date,
    bot: logBotValue(value.bot),
    status: logStatusValue(value.status),
    hits: numberValue(value.hits),
    bytes: numberValue(value.bytes),
    p95_ms: numberValue(value.p95_ms),
  };
}

function normalizeByBot(value: unknown): WasteByBot[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const rows: WasteByBot[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    rows.push({
      bot: logBotValue(item.bot),
      hits: numberValue(item.hits),
      bytes: numberValue(item.bytes),
      share: numberValue(item.share),
      total_hits: numberValue(item.total_hits),
    });
  }
  return rows;
}

function normalizeWaste(value: unknown): CrawlWaste {
  const data = isRecord(value) ? value : {};
  return {
    hits: numberValue(data.hits),
    bytes: numberValue(data.bytes),
    share: numberValue(data.share),
    total_hits: numberValue(data.total_hits),
    total_bytes: numberValue(data.total_bytes),
    by_bot: normalizeByBot(data.by_bot),
  };
}

/**
 * Map the `logs_analyze` payload into the page model. A malformed row without a
 * date is dropped; every other value survives as a number or `null`, so the UI
 * never invents a zero.
 */
export function normalizeLogsResult(value: unknown): LogsResult {
  const data = isRecord(value) ? value : {};
  const rows = Array.isArray(data.bot_daily)
    ? data.bot_daily
        .map(normalizeRow)
        .filter((row): row is LogDailyRow => row !== null)
    : [];
  return {
    total_lines: numberValue(data.total_lines),
    parsed_lines: numberValue(data.parsed_lines),
    skipped_lines: numberValue(data.skipped_lines),
    bot_daily: rows,
    crawl_waste: normalizeWaste(data.crawl_waste),
  };
}

/** Limitations from the envelope, de-duplicated and trimmed. */
export function logsLimitations(meta: LogsMeta): string[] {
  const items = Array.isArray(meta.limitations) ? meta.limitations : [];
  return [
    ...new Set(
      items.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      ),
    ),
  ];
}
