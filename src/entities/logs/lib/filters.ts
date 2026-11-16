import type { LogBotValue, LogDailyRow, LogStatusValue } from "../model/types";

/** `all` keeps every row; the other values match one facet exactly. */
export interface LogFilters {
  bot: LogBotValue | "all";
  status: LogStatusValue | "all";
}

export const LOG_FILTERS_DEFAULT: LogFilters = { bot: "all", status: "all" };

export interface LogFacet<T extends string> {
  value: T;
  count: number;
}

export interface LogFacets {
  bots: Array<LogFacet<LogBotValue>>;
  statuses: Array<LogFacet<LogStatusValue>>;
}

function countBy<T extends string>(
  rows: readonly LogDailyRow[],
  pick: (row: LogDailyRow) => T,
): Array<LogFacet<T>> {
  const counts = new Map<T, number>();
  for (const row of rows) {
    const value = pick(row);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ value, count }));
}

/** Facets present in the current result; absent values never appear. */
export function logFacets(rows: readonly LogDailyRow[]): LogFacets {
  return {
    bots: countBy(rows, (row) => row.bot),
    statuses: countBy(rows, (row) => row.status),
  };
}

/**
 * Drop a filter that no longer exists in the result (for example after a rerun
 * with another bot), so the table cannot look empty because of a stale value.
 */
export function effectiveLogFilters(
  filters: LogFilters,
  facets: LogFacets,
): LogFilters {
  const bot =
    filters.bot === "all" ||
    facets.bots.some((facet) => facet.value === filters.bot)
      ? filters.bot
      : "all";
  const status =
    filters.status === "all" ||
    facets.statuses.some((facet) => facet.value === filters.status)
      ? filters.status
      : "all";
  return bot === filters.bot && status === filters.status
    ? filters
    : { bot, status };
}

export function filterLogRows(
  rows: readonly LogDailyRow[],
  filters: LogFilters,
): LogDailyRow[] {
  return rows.filter(
    (row) =>
      (filters.bot === "all" || row.bot === filters.bot) &&
      (filters.status === "all" || row.status === filters.status),
  );
}

/**
 * Newest date first, then bot and status, so the same payload always renders in
 * the same order. Rows without a date (`unknown`) stay last.
 */
export function sortLogRows(rows: readonly LogDailyRow[]): LogDailyRow[] {
  return [...rows].sort((left, right) => {
    if (left.date !== right.date) {
      if (left.date === "unknown") {
        return 1;
      }
      if (right.date === "unknown") {
        return -1;
      }
      return right.date.localeCompare(left.date);
    }
    if (left.bot !== right.bot) {
      return left.bot.localeCompare(right.bot);
    }
    return left.status.localeCompare(right.status);
  });
}
