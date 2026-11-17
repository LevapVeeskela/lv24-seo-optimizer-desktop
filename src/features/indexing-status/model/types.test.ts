import { describe, expect, it } from "vitest";
import {
  aggregateRunsByDay,
  isUnknownEngineError,
  normalizeIndexingHistory,
  normalizeIndexingStatus,
  normalizeScheduleStatus,
  providerNotReady,
  recentTotals,
} from "./types";

describe("indexing status normalization", () => {
  it("keeps provider counts, quotas and envelope metadata", () => {
    const report = normalizeIndexingStatus(
      {
        providers: {
          bing: {
            property_id: "https://lv24.by",
            urls: 120,
            submitted: 80,
            pending: 40,
            quota: {
              source: "provider",
              remaining: 90,
              daily_remaining: 90,
              monthly_remaining: 1200,
            },
            limitations: ["no_per_url_index_count"],
            data_age_days: 1,
          },
          gsc: {
            property_id: "sc-domain:lv24.by",
            submitted: 30,
            indexed: 12,
            indexed_total: 120,
            indexed_total_source: "gsc_sitemaps_contents",
            quota: { source: "local", used: 7, limit: 50 },
          },
        },
        write_secret_present: true,
        limitations: ["no_per_url_index_count"],
      },
      {
        total: 150,
        truncated: true,
        data_age_days: 2,
        limitations: ["history_limit"],
        live: true,
      },
    );

    expect(Object.keys(report.providers)).toEqual(["bing", "gsc"]);
    expect(report.providers.bing?.submitted).toBe(80);
    expect(report.providers.bing?.quota?.dailyRemaining).toBe(90);
    expect(report.providers.bing?.quota?.monthlyRemaining).toBe(1200);
    expect(report.providers.gsc?.indexed).toBe(12);
    expect(report.providers.gsc?.indexedTotal).toBe(120);
    expect(report.providers.gsc?.indexedTotalSource).toBe(
      "gsc_sitemaps_contents",
    );
    expect(report.providers.gsc?.quota?.used).toBe(7);
    expect(report.providers.gsc?.quota?.limit).toBe(50);
    expect(report.providers.yandex).toBeUndefined();
    expect(report.limitations).toEqual([
      "no_per_url_index_count",
      "history_limit",
    ]);
    expect(report.total).toBe(150);
    expect(report.truncated).toBe(true);
    expect(report.dataAgeDays).toBe(2);
    expect(report.live).toBe(true);
  });

  it("does not invent counts or a quota for an empty entry", () => {
    const report = normalizeIndexingStatus({ providers: { bing: {} } });
    expect(report.providers.bing?.urls).toBeNull();
    expect(report.providers.bing?.quota).toBeNull();
    expect(report.limitations).toEqual([]);
    expect(report.dataAgeDays).toBeNull();
  });

  it("marks a not-configured provider so the card can say no data", () => {
    const report = normalizeIndexingStatus({
      providers: {
        yandex: {
          urls: 0,
          submitted: 0,
          limitations: ["provider_not_configured"],
        },
      },
    });
    expect(providerNotReady(report.providers.yandex!)).toBe(true);
    expect(
      providerNotReady(
        normalizeIndexingStatus({
          providers: { gsc: { urls: 2, submitted: 1 } },
        }).providers.gsc!,
      ),
    ).toBe(false);
  });
});

describe("indexing history normalization", () => {
  it("reads runs, counts and bounded error items", () => {
    const report = normalizeIndexingHistory(
      {
        runs: [
          {
            started_at: "2026-11-18T04:00:00Z",
            finished_at: "2026-11-18T04:02:00Z",
            provider: "bing",
            status: "ok",
            planned: 50,
            submitted: 40,
            checked: 10,
            skipped: 1,
            detail: {
              errors: 2,
              error_items: [
                {
                  url: "https://lv24.by/a",
                  code: "HTTP_429",
                  message: "quota",
                },
                { url: "https://lv24.by/b" },
                { message: "no url" },
                {},
              ],
            },
          },
          { started_at: "2026-11-17T04:00:00Z" },
          {},
        ],
      },
      { total: 2, truncated: true, limitations: ["history_limit"] },
    );

    expect(report.runs).toHaveLength(2);
    expect(report.runs[0].submitted).toBe(40);
    expect(report.runs[0].checked).toBe(10);
    expect(report.runs[0].errors).toBe(2);
    expect(report.runs[0].errorItems).toHaveLength(3);
    expect(report.runs[0].errorItems[0]).toEqual({
      url: "https://lv24.by/a",
      code: "HTTP_429",
      message: "quota",
    });
    expect(report.total).toBe(2);
    expect(report.truncated).toBe(true);
    expect(report.limitations).toEqual(["history_limit"]);
  });

  it("returns an empty history instead of throwing on a malformed answer", () => {
    expect(normalizeIndexingHistory(null).runs).toEqual([]);
    expect(normalizeIndexingHistory({ runs: "nope" }).runs).toEqual([]);
  });
});

describe("schedule status normalization", () => {
  it("accepts only documented states", () => {
    expect(normalizeScheduleStatus({ state: "installed" }).state).toBe(
      "installed",
    );
    expect(normalizeScheduleStatus({ state: "missing" }).state).toBe("missing");
    expect(normalizeScheduleStatus({ state: "paused" }).state).toBeNull();
    expect(normalizeScheduleStatus({}).state).toBeNull();
  });

  it("keeps the job name, target and warnings", () => {
    const report = normalizeScheduleStatus(
      {
        name: "lv24-seo-indexing",
        target: "windows",
        warnings: ["schtasks is not available"],
      },
      { kind: "indexing" },
    );
    expect(report.name).toBe("lv24-seo-indexing");
    expect(report.target).toBe("windows");
    expect(report.warnings).toEqual(["schtasks is not available"]);
  });
});

describe("history aggregation", () => {
  const runs = normalizeIndexingHistory({
    runs: [
      {
        started_at: "2026-11-18T04:00:00Z",
        provider: "bing",
        submitted: 40,
        checked: 10,
      },
      {
        started_at: "2026-11-18T05:00:00Z",
        provider: "bing",
        submitted: 5,
        checked: 2,
      },
      {
        started_at: "2026-11-17T04:00:00Z",
        provider: "gsc",
        submitted: 3,
        checked: 3,
      },
      { provider: "bing", submitted: 1 },
    ],
  }).runs;

  it("groups runs by day and provider, newest day first", () => {
    const buckets = aggregateRunsByDay(runs);
    expect(buckets.map((bucket) => `${bucket.day}:${bucket.provider}`)).toEqual(
      ["2026-11-18:bing", "2026-11-17:gsc", "unknown:bing"],
    );
    expect(buckets[0].runs).toBe(2);
    expect(buckets[0].submitted).toBe(45);
    expect(buckets[0].checked).toBe(12);
    expect(buckets[1].submitted).toBe(3);
  });

  it("totals the last 7 and 30 days from the newest run", () => {
    expect(recentTotals(runs, 7)).toEqual({
      runs: 3,
      submitted: 48,
      checked: 15,
    });
    expect(recentTotals(runs, 30)).toEqual({
      runs: 3,
      submitted: 48,
      checked: 15,
    });
    expect(recentTotals([], 7)).toEqual({
      runs: 0,
      submitted: null,
      checked: null,
    });
  });
});

describe("engine compatibility", () => {
  it("treats an unknown command as an old engine", () => {
    expect(isUnknownEngineError("INVALID_COMMAND")).toBe(true);
    expect(isUnknownEngineError("CLI_INVALID_JSON")).toBe(true);
    expect(isUnknownEngineError("UNKNOWN_COMMAND")).toBe(true);
    expect(isUnknownEngineError("AUTH_REQUIRED")).toBe(false);
    expect(isUnknownEngineError(null)).toBe(false);
  });
});
