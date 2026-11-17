import { describe, expect, it } from "vitest";
import {
  emptyReason,
  normalizeBingCrawl,
  normalizeBingJoins,
  normalizeBingPages,
  normalizeBingUrlInfo,
  normalizeCwvAudits,
  normalizeCwvHistory,
  normalizeGscInspection,
  normalizeGscSitemaps,
  normalizeMetrikaBytime,
  normalizeMetrikaGoals,
  normalizeMetrikaPages,
  normalizeYandexIndexing,
  normalizeYandexQueue,
  normalizeYandexSitemaps,
  withEnvelopeMeta,
} from "./types";

describe("diagnostics normalizers", () => {
  it("normalizes a GSC URL inspection without inventing fields", () => {
    const report = normalizeGscInspection(
      withEnvelopeMeta(
        {
          url: "https://example.com/page",
          language: "en-US",
          inspection: {
            url: "https://example.com/page",
            verdict: "PASS",
            coverage_state: "Submitted and indexed",
            indexing_state: "INDEXING_ALLOWED",
            robots_txt_state: "ALLOWED",
            page_fetch_state: "SUCCESSFUL",
            last_crawl_time: "2026-11-15T10:00:00Z",
            canonical: "https://example.com/page",
            crawled_as: "MOBILE",
            sitemap: ["https://example.com/sitemap.xml"],
            referring_urls: ["https://example.com/"],
            rich_results: {
              verdict: "PASS",
              detected_items: [
                {
                  rich_result_type: "Article",
                  items: [{ issues: ["a", "b"] }, { issues: ["c"] }],
                },
              ],
            },
            inspection_result_link: "https://search.google.com/...",
          },
        },
        {
          total: 1,
          truncated: false,
          data_age_days: 1,
          limitations: ["one_url_per_call"],
        },
      ),
    );

    expect(report.url).toBe("https://example.com/page");
    expect(report.verdict).toBe("PASS");
    expect(report.coverageState).toBe("Submitted and indexed");
    expect(report.canonical).toBe("https://example.com/page");
    expect(report.crawledAs).toBe("MOBILE");
    expect(report.lastCrawlTime).toBe("2026-11-15T10:00:00Z");
    expect(report.richResults?.items).toEqual([
      { type: "Article", issueCount: 3 },
    ]);
    expect(report.referringUrls).toEqual(["https://example.com/"]);
    expect(report.meta.total).toBe(1);
    expect(report.meta.dataAgeDays).toBe(1);
    expect(report.meta.limitations).toContain("one_url_per_call");
  });

  it("normalizes GSC sitemaps and the optional index summary", () => {
    const report = normalizeGscSitemaps(
      withEnvelopeMeta(
        {
          rows: [
            {
              path: "https://example.com/sitemap.xml",
              type: "sitemap",
              is_sitemaps_index: false,
              errors: 0,
              warnings: 2,
              contents: [
                {
                  type: "web",
                  submitted: 42,
                  indexed: 0,
                  indexed_deprecated: true,
                },
              ],
            },
          ],
          sitemap_index: null,
        },
        { limitations: ["sitemap_indexed_count_deprecated"] },
      ),
    );

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].isSitemapsIndex).toBe(false);
    expect(report.rows[0].contents[0].submitted).toBe(42);
    expect(report.rows[0].contents[0].indexedDeprecated).toBe(true);
    expect(report.sitemapIndex).toBeNull();
    expect(report.meta.limitations).toContain(
      "sitemap_indexed_count_deprecated",
    );
  });

  it("normalizes Yandex events, HTTP buckets and counters", () => {
    const report = normalizeYandexIndexing(
      withEnvelopeMeta(
        {
          host_id: "https:example.com",
          events: [{ date: "2026-11-01", appeared: 12, removed: 3 }],
          history: [
            {
              date: "2026-11-01",
              http_2xx: 120,
              http_3xx: 4,
              http_4xx: 2,
              http_5xx: 0,
            },
          ],
          summary: [
            {
              sqi: 310,
              pages_in_search: 420,
              pages_excluded: 8,
              http_2xx: 120,
              site_problems: { fatal: 1, critical: 2 },
            },
          ],
        },
        { data_age_days: 0, truncated: false },
      ),
    );

    expect(report.events[0]).toEqual({
      date: "2026-11-01",
      appeared: 12,
      removed: 3,
    });
    expect(report.history[0].http2xx).toBe(120);
    expect(report.history[0].http5xx).toBe(0);
    expect(report.history[0].other).toBeNull();
    expect(report.summary).toEqual({
      sqi: 310,
      pagesInSearch: 420,
      pagesExcluded: 8,
      http2xx: 120,
      siteProblems: 3,
    });
  });

  it("normalizes Yandex sitemaps and the queue total", () => {
    const sitemaps = normalizeYandexSitemaps(
      withEnvelopeMeta(
        {
          host_id: "https:example.com",
          rows: [
            {
              sitemap_id: "1",
              sitemap_url: "https://example.com/sitemap.xml",
              urls_count: 10,
              errors_count: 1,
              children_count: 0,
              sitemap_type: "SITEMAP",
              last_access_date: "2026-11-10T09:00:00Z",
            },
          ],
        },
        { total: 1, truncated: false },
      ),
    );
    expect(sitemaps.rows[0].urlsCount).toBe(10);
    expect(sitemaps.rows[0].errorsCount).toBe(1);

    const queue = normalizeYandexQueue(
      withEnvelopeMeta(
        {
          rows: [
            {
              task_id: "task-1",
              url: "https://example.com/page",
              state: "DONE",
              added_time: "2026-11-10T09:00:00Z",
            },
          ],
        },
        { total: 7, truncated: true },
      ),
    );
    expect(queue.rows[0].taskId).toBe("task-1");
    expect(queue.meta.total).toBe(7);
    expect(queue.meta.truncated).toBe(true);
  });

  it("turns an empty Bing window into an explicit reason, never zeros", () => {
    const pages = normalizeBingPages(
      withEnvelopeMeta(
        { site_url: "https://example.com/", rows: [] },
        {
          total: 0,
          truncated: false,
          data_age_days: null,
          limitations: ["no_rows_for_window"],
        },
      ),
    );
    expect(pages.rows).toEqual([]);
    expect(emptyReason(pages.meta)).toBe("no_rows_for_window");

    const urlinfo = normalizeBingUrlInfo(
      withEnvelopeMeta(
        { rows: [] },
        { limitations: ["provider_returned_no_rows"] },
      ),
    );
    expect(emptyReason(urlinfo.meta)).toBe("provider_returned_no_rows");
  });

  it("normalizes Bing page, crawl and join rows", () => {
    const pages = normalizeBingPages(
      withEnvelopeMeta(
        {
          site_url: "https://example.com/",
          rows: [
            {
              page: "https://example.com/",
              clicks: 4,
              impressions: 40,
              click_position: 2.5,
              impression_position: 3,
              date: "2026-11-10T00:00:00Z",
            },
          ],
        },
        { data_age_days: 1 },
      ),
    );
    expect(pages.rows[0].clickPosition).toBe(2.5);
    expect(pages.meta.dataAgeDays).toBe(1);

    const crawl = normalizeBingCrawl(
      withEnvelopeMeta(
        {
          rows: [
            {
              date: "2026-11-10",
              code_2xx: 10,
              code_301: 1,
              crawl_errors: 2,
              in_index: 8,
              in_links: 3,
            },
          ],
        },
        { limitations: ["crawl_stats_six_month_window"] },
      ),
    );
    expect(crawl.rows[0].code2xx).toBe(10);
    expect(crawl.rows[0].code5xx).toBeNull();
    expect(crawl.meta.limitations).toContain(
      "crawl_stats_six_month_window",
    );

    const joins = normalizeBingJoins(
      withEnvelopeMeta(
        {
          mode: "query_pages",
          query: "seo tools",
          rows: [
            {
              query: "seo tools",
              page: "https://example.com/page",
              clicks: 1,
              impressions: 9,
              position: 4,
              date: null,
            },
          ],
        },
        { limitations: [] },
      ),
    );
    expect(joins.mode).toBe("query_pages");
    expect(joins.rows[0].date).toBeNull();
  });

  it("normalizes Metrika tables, goals and sampling facts", () => {
    const pages = normalizeMetrikaPages(
      withEnvelopeMeta(
        {
          counter: "123",
          rows: [
            {
              startURLPath: "/",
              visits: 10,
              users: 8,
              bounceRate: 0.25,
              avgVisitDurationSeconds: 61.5,
              pageDepth: 1.8,
              pageviews: 22,
            },
          ],
        },
        {
          organic_only: true,
          sampled: true,
          sample_share: 0.42,
          sample_size: 420,
          sample_space: 1000,
          data_lag: 1,
          total_rows_rounded: true,
          limitations: ["sampled"],
        },
      ),
    );
    expect(pages.rows[0].label).toBe("/");
    expect(pages.rows[0].bounceRate).toBe(0.25);
    expect(pages.meta.organicOnly).toBe(true);
    expect(pages.meta.sampled).toBe(true);
    expect(pages.meta.sampleShare).toBe(0.42);
    expect(pages.meta.totalRowsRounded).toBe(true);
    expect(pages.meta.limitations).toContain("sampled");

    const goals = normalizeMetrikaGoals(
      withEnvelopeMeta(
        {
          counter: "123",
          goals: ["1", "2"],
          goals_configured: ["1", "2", "3"],
          rows: [
            {
              startURLPath: "/pricing",
              goal1reaches: 5,
              goal1visits: 4,
              goal1users: 3,
              goal1conversionRate: 0.5,
              goal2reaches: 1,
            },
          ],
        },
        { truncated: true, limitations: ["truncated: goals"] },
      ),
    );
    expect(goals.goals).toEqual(["1", "2"]);
    expect(goals.configured).toEqual(["1", "2", "3"]);
    expect(goals.rows[0].goals[0]).toEqual({
      id: "1",
      reaches: 5,
      visits: 4,
      users: 3,
      conversionRate: 0.5,
    });
    expect(goals.rows[0].goals[1].visits).toBeNull();

    const bytime = normalizeMetrikaBytime(
      withEnvelopeMeta(
        { rows: [{ date: "2026-11-10", visits: 3, users: 2 }] },
        { group: "day" },
      ),
    );
    expect(bytime.rows[0].date).toBe("2026-11-10");
    expect(bytime.meta.group).toBe("day");
  });

  it("normalizes CWV audits and a low-traffic history", () => {
    const audits = normalizeCwvAudits(
      withEnvelopeMeta(
        {
          url: "https://example.com/",
          strategy: "mobile",
          categories: [{ category: "performance", score: 0.87 }],
          audits: [
            {
              id: "render-blocking-resources",
              title: "Eliminate render-blocking resources",
              score: 0.5,
              display_value: "Potential savings of 300 ms",
              description: "Resources are blocking the first paint.",
              details_type: "opportunity",
              overall_savings_ms: 300,
              overall_savings_bytes: 1024,
              items_count: 2,
            },
          ],
        },
        {
          strategy: "mobile",
          analysis_utc_timestamp: "2026-11-17T10:00:00Z",
          final_url: "https://example.com/",
          limitations: ["psi_audits_cap"],
        },
      ),
    );
    expect(audits.categories[0].score).toBe(0.87);
    expect(audits.audits[0].overallSavingsMs).toBe(300);
    expect(audits.audits[0].itemsCount).toBe(2);
    expect(audits.meta.finalUrl).toBe("https://example.com/");

    const history = normalizeCwvHistory(
      withEnvelopeMeta(
        {
          target: "https://example.com",
          scope: "origin",
          device: "all",
          weeks_requested: 12,
          periods: [
            {
              first_date: "2026-11-01",
              last_date: "2026-11-07",
              lcp: 2100,
              cls: 0.04,
            },
          ],
          metrics: ["lcp", "cls"],
        },
        {
          data_age_days: 10,
          weeks_requested: 12,
          weeks_returned: 1,
          device: "all",
          limitations: ["crux_history_gaps"],
        },
      ),
    );
    expect(history.periods[0].lcp).toBe(2100);
    expect(history.periods[0].inp).toBeNull();
    expect(history.meta.dataAgeDays).toBe(10);
    expect(history.meta.limitations).toContain("crux_history_gaps");

    const lowTraffic = normalizeCwvHistory(
      withEnvelopeMeta(
        { periods: [] },
        { limitations: ["low_traffic"] },
      ),
    );
    expect(emptyReason(lowTraffic.meta)).toBe("low_traffic");
  });
});
