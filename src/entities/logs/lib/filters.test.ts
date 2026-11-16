import { describe, expect, it } from "vitest";
import {
  LOG_FILTERS_DEFAULT,
  effectiveLogFilters,
  filterLogRows,
  logFacets,
  sortLogRows,
} from "./filters";
import type { LogDailyRow } from "../model/types";

function row(overrides: Partial<LogDailyRow> = {}): LogDailyRow {
  return {
    date: "2026-11-15",
    bot: "googlebot",
    status: "2xx",
    hits: 10,
    bytes: 1024,
    p95_ms: 12,
    ...overrides,
  };
}

const ROWS: LogDailyRow[] = [
  row({ date: "2026-11-14", bot: "bingbot", status: "2xx" }),
  row({ date: "2026-11-15", bot: "googlebot", status: "2xx" }),
  row({ date: "2026-11-15", bot: "googlebot", status: "4xx" }),
  row({ date: "unknown", bot: "other", status: "5xx" }),
];

describe("logFacets", () => {
  it("counts rows per bot and status and sorts by value", () => {
    const facets = logFacets(ROWS);
    expect(facets.bots).toEqual([
      { value: "bingbot", count: 1 },
      { value: "googlebot", count: 2 },
      { value: "other", count: 1 },
    ]);
    expect(facets.statuses.map((facet) => facet.value)).toEqual([
      "2xx",
      "4xx",
      "5xx",
    ]);
    expect(facets.statuses[0]?.count).toBe(2);
  });

  it("returns empty facets for an empty result", () => {
    expect(logFacets([])).toEqual({ bots: [], statuses: [] });
  });
});

describe("filterLogRows", () => {
  it("keeps every row by default", () => {
    expect(filterLogRows(ROWS, LOG_FILTERS_DEFAULT)).toHaveLength(4);
  });

  it("combines the bot and status filters", () => {
    const rows = filterLogRows(ROWS, { bot: "googlebot", status: "4xx" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("4xx");
  });

  it("can select the unknown bucket explicitly", () => {
    expect(filterLogRows(ROWS, { bot: "other", status: "all" })).toHaveLength(1);
  });
});

describe("effectiveLogFilters", () => {
  it("drops a filter that no longer exists in the result", () => {
    const facets = logFacets(ROWS);
    expect(
      effectiveLogFilters({ bot: "yandexbot", status: "3xx" }, facets),
    ).toEqual({ bot: "all", status: "all" });
  });

  it("keeps a filter that is still present and returns the same object", () => {
    const facets = logFacets(ROWS);
    const filters = { bot: "googlebot" as const, status: "4xx" as const };
    expect(effectiveLogFilters(filters, facets)).toBe(filters);
  });
});

describe("sortLogRows", () => {
  it("puts the newest date first, then bot and status, with unknown last", () => {
    const sorted = sortLogRows(ROWS);
    expect(sorted.map((item) => `${item.date}|${item.bot}|${item.status}`)).toEqual([
      "2026-11-15|googlebot|2xx",
      "2026-11-15|googlebot|4xx",
      "2026-11-14|bingbot|2xx",
      "unknown|other|5xx",
    ]);
  });

  it("does not mutate the input", () => {
    const copy = [...ROWS];
    sortLogRows(ROWS);
    expect(ROWS).toEqual(copy);
  });
});
