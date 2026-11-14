import { describe, expect, it } from "vitest";
import type { ReportSection, WeeklyReport } from "@/entities/report/model/types";
import type { StatsData } from "@/entities/stats/model/types";
import {
  buildRecommendations,
  normalizeSeverity,
  opportunitySeverity,
  stableRecommendationId,
} from "./buildRecommendations";

const PERIOD = { start: "2026-11-01", end: "2026-11-07" };

function weeklyReport(
  sections: ReportSection[],
  limitations: string[] = [],
): WeeklyReport {
  return {
    kind: "weekly",
    property_id: "sc-domain:example.com",
    period: PERIOD,
    generated_at: "2026-11-08T08:00:00+00:00",
    headline: "Test headline",
    sections,
    limitations,
  };
}

function opportunitySection(rows: ReportSection["rows"]): ReportSection {
  return {
    key: "opportunities",
    title: "Opportunities",
    summary: "",
    rows,
    notes: [],
  };
}

function issueSection(rows: ReportSection["rows"]): ReportSection {
  return {
    key: "issues",
    title: "Issues by severity",
    summary: "",
    rows,
    notes: [],
  };
}

function sourceSection(
  rows: ReportSection["rows"],
  notes: string[] = [],
): ReportSection {
  return {
    key: "sources",
    title: "Sources",
    summary: "",
    rows,
    notes,
  };
}

describe("buildRecommendations", () => {
  it("turns opportunity rows into scoped tasks with evidence and estimates", () => {
    const report = weeklyReport([
      opportunitySection([
        {
          kind: "striking_distance",
          query: "seo audit",
          page: "https://example.com/seo-audit",
          clicks: 12,
          impressions: 1200,
          ctr: 0.01,
          position: 12.4,
          expected_clicks: 36,
          evidence: {
            position: 12.4,
            impressions: 1200,
            position_band: "8-20",
            ctr_lift: 0.03,
          },
        },
        {
          kind: "ctr_gap",
          query: "local seo",
          page: null,
          clicks: 8,
          impressions: 800,
          ctr: 0.01,
          position: 6,
          expected_clicks: 24,
          evidence: {
            position: 6,
            impressions: 800,
            ctr: 0.01,
            expected_ctr: 0.04,
          },
        },
        {
          kind: "decay",
          query: "rank tracker",
          page: "https://example.com/tools/rank",
          clicks: 2,
          impressions: 100,
          ctr: 0.02,
          position: 8,
          expected_clicks: 18,
          evidence: {
            previous_clicks: 20,
            clicks: 2,
            decay_ratio: 0.5,
            match: "query+page",
          },
        },
        {
          kind: "unsupported_kind",
          query: "ignored",
          expected_clicks: 100,
          evidence: {},
        },
      ]),
    ]);

    const recommendations = buildRecommendations(report, null);
    expect(recommendations).toHaveLength(3);
    expect(recommendations.map((item) => item.query)).toEqual([
      "seo audit",
      "rank tracker",
      "local seo",
    ]);

    const striking = recommendations.find(
      (item) => item.query === "seo audit",
    );
    expect(striking).toMatchObject({
      category: "opportunity",
      severity: "high",
      source: "gsc",
      provider: "gsc",
      page: "https://example.com/seo-audit",
      expected_clicks: 36,
    });
    expect(striking?.title).toContain("position 12.4");
    expect(striking?.evidence).toEqual([
      { key: "position", value: "12.4" },
      { key: "impressions", value: "1200" },
      { key: "position_band", value: "8-20" },
      { key: "ctr_lift", value: "3%" },
    ]);

    const ctrGap = recommendations.find((item) => item.query === "local seo");
    expect(ctrGap?.severity).toBe("medium");
    expect(ctrGap?.page).toBeUndefined();
    expect(ctrGap?.evidence).toContainEqual({
      key: "expected_ctr",
      value: "4%",
    });

    const decay = recommendations.find(
      (item) => item.query === "rank tracker",
    );
    expect(decay?.severity).toBe("high");
    expect(decay?.evidence).toContainEqual({
      key: "previous_clicks",
      value: "20",
    });
    expect(decay?.evidence).toContainEqual({
      key: "decay_ratio",
      value: "50%",
    });
    expect(decay?.evidence).toContainEqual({
      key: "match",
      value: "query+page",
    });

    expect(
      recommendations.some((item) => item.query === "ignored"),
    ).toBe(false);
  });

  it("maps issue severity groups to crawl tasks without inventing URLs", () => {
    const report = weeklyReport([
      issueSection([
        {
          severity: "critical",
          count: 3,
          rule_ids: ["missing_title", "broken_link"],
        },
        {
          severity: "critical",
          count: 3,
          rule_ids: ["missing_title", "broken_link"],
        },
        { severity: "high", count: 1, rule_ids: [] },
        { severity: "low", count: 0, rule_ids: ["zero_count"] },
        { severity: "unexpected", count: 2, rule_ids: ["unknown_rule"] },
      ]),
    ]);

    const recommendations = buildRecommendations(report, null);
    expect(recommendations).toHaveLength(3);
    expect(recommendations.every((item) => item.category === "crawl")).toBe(
      true,
    );
    expect(recommendations.every((item) => item.source === "crawl")).toBe(
      true,
    );
    expect(recommendations.every((item) => item.page === undefined)).toBe(
      true,
    );

    const critical = recommendations.find(
      (item) => item.severity === "critical",
    );
    expect(critical?.title).toBe("Fix 3 critical crawl issues");
    expect(critical?.count).toBe(3);
    expect(critical?.rule_ids).toEqual(["broken_link", "missing_title"]);
    expect(critical?.action).toContain("never invent URLs");
    expect(critical?.evidence).toContainEqual({
      key: "rule_ids",
      value: "broken_link, missing_title",
    });

    expect(
      recommendations.some((item) => item.title === "Fix 1 high crawl issue"),
    ).toBe(true);
    expect(
      recommendations.some(
        (item) => item.title === "Fix 2 medium crawl issues",
      ),
    ).toBe(true);
    const mapped = recommendations.find((item) =>
      item.evidence.some((entry) => entry.key === "mapped_severity"),
    );
    expect(mapped?.evidence).toContainEqual({
      key: "severity",
      value: "unexpected",
    });
    expect(mapped?.evidence).toContainEqual({
      key: "mapped_severity",
      value: "medium",
    });
    expect(
      recommendations.some((item) => item.title.includes("zero_count")),
    ).toBe(false);
  });

  it("derives configuration and data-quality tasks from stats and sources", () => {
    const stats: StatsData = {
      period: PERIOD,
      services: [
        {
          provider: "gsc",
          configured: true,
          ready: false,
          status: "missing_token",
          rows: 0,
        },
        {
          provider: "bing",
          configured: true,
          ready: true,
          status: "no_data",
          rows: 0,
        },
        {
          provider: "psi",
          configured: true,
          ready: true,
          status: "error",
          rows: 0,
          error: { code: "PSI_TIMEOUT", message: "request timed out" },
        },
        {
          provider: "crux",
          configured: true,
          ready: true,
          status: "ok",
          rows: 10,
          truncated: true,
        },
        {
          provider: "yandex_webmaster",
          configured: false,
          ready: false,
          status: "not_configured",
          rows: 0,
        },
      ],
      limitations: ["GSC data lag 2-3 days"],
    };
    const report = weeklyReport(
      [
        sourceSection(
          [
            { source: "gsc", status: "missing", rows: 0, limitations: [] },
            {
              source: "metrika",
              status: "missing",
              rows: 0,
              limitations: ["top-3000 queries only"],
            },
          ],
          ["limitation: GSC data lag 2-3 days"],
        ),
      ],
      ["GSC data lag 2-3 days"],
    );

    const recommendations = buildRecommendations(report, stats);
    const ids = recommendations.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);

    const missingToken = recommendations.find(
      (item) => item.title === "Connect Google Search Console: token missing",
    );
    expect(missingToken).toMatchObject({
      category: "configuration",
      severity: "high",
      source: "stats",
      provider: "gsc",
      status: "missing_token",
    });
    expect(missingToken?.action).toContain("Never paste the token");

    const noData = recommendations.find(
      (item) => item.title === "No Bing Webmaster data for this period",
    );
    expect(noData).toMatchObject({
      category: "data_quality",
      severity: "medium",
      source: "stats",
    });

    const providerError = recommendations.find(
      (item) => item.title === "PageSpeed Insights (PSI) returned an error",
    );
    expect(providerError?.severity).toBe("high");
    expect(providerError?.evidence).toContainEqual({
      key: "error_code",
      value: "PSI_TIMEOUT",
    });
    expect(providerError?.evidence).toContainEqual({
      key: "error_message",
      value: "request timed out",
    });

    const truncated = recommendations.find(
      (item) => item.title === "Chrome UX Report (CrUX) data is truncated",
    );
    expect(truncated).toMatchObject({
      category: "data_quality",
      severity: "low",
    });

    const notConfigured = recommendations.find(
      (item) => item.title === "Configure Yandex Webmaster",
    );
    expect(notConfigured).toMatchObject({
      category: "configuration",
      severity: "medium",
    });

    const missingSource = recommendations.find(
      (item) => item.title === "No Yandex Metrika rows in the weekly report",
    );
    expect(missingSource).toMatchObject({
      category: "data_quality",
      severity: "medium",
      source: "report",
      provider: "yandex_metrika",
    });
    expect(
      recommendations.some(
        (item) =>
          item.title === "No Google Search Console rows in the weekly report",
      ),
    ).toBe(false);

    const limitations = recommendations.filter((item) =>
      item.title.startsWith("Data limitation"),
    );
    expect(limitations).toHaveLength(2);
    expect(
      limitations
        .map(
          (item) =>
            item.evidence.find((entry) => entry.key === "limitation")?.value,
        )
        .sort(),
    ).toEqual(["GSC data lag 2-3 days", "top-3000 queries only"]);
  });

  it("never claims zero, null or invented values", () => {
    const report = weeklyReport([
      opportunitySection([
        {
          kind: "ctr_gap",
          query: "empty metrics",
          page: null,
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
          expected_clicks: 0,
          evidence: {
            position: 0,
            impressions: 0,
            ctr: 0,
            expected_ctr: 0.04,
          },
        },
      ]),
      issueSection([{ severity: "high", count: 0, rule_ids: ["ignored"] }]),
    ]);
    const stats: StatsData = {
      services: [
        {
          provider: "gsc",
          configured: true,
          ready: true,
          status: "ok",
          rows: 0,
        },
      ],
    };

    const recommendations = buildRecommendations(report, stats);
    expect(recommendations).toHaveLength(1);
    const [item] = recommendations;
    expect(item.expected_clicks).toBeUndefined();
    expect(item.title).not.toContain("position 0");
    expect(item.evidence).toEqual([{ key: "expected_ctr", value: "4%" }]);
    expect(JSON.stringify(item)).not.toContain("null");
    expect(JSON.stringify(item)).not.toContain("undefined");
    expect(JSON.stringify(item)).not.toContain('"value":"0"');
  });

  it("deduplicates rows and keeps ids stable across runs", () => {
    const report = weeklyReport(
      [
        opportunitySection([
          {
            kind: "striking_distance",
            query: "duplicate query",
            page: "https://example.com/page",
            position: 9,
            impressions: 400,
            expected_clicks: 12,
            evidence: { position: 9, impressions: 400, ctr_lift: 0.03 },
          },
          {
            kind: "striking_distance",
            query: "duplicate query",
            page: "https://example.com/page",
            position: 9,
            impressions: 400,
            expected_clicks: 12,
            evidence: { position: 9, impressions: 400, ctr_lift: 0.03 },
          },
        ]),
      ],
      ["GSC data lag 2-3 days"],
    );
    const stats: StatsData = {
      limitations: ["GSC data lag 2-3 days"],
      services: [],
    };

    const first = buildRecommendations(report, stats);
    const second = buildRecommendations(report, stats);
    expect(first.map((item) => item.id)).toEqual(
      second.map((item) => item.id),
    );
    expect(first).toHaveLength(2);
    expect(
      first.filter((item) => item.title.startsWith("Data limitation")),
    ).toHaveLength(1);

    expect(stableRecommendationId("opportunity", "gsc", "a b")).toBe(
      stableRecommendationId("opportunity", "gsc", "a b"),
    );
    expect(stableRecommendationId("opportunity", "gsc", "a b")).not.toBe(
      stableRecommendationId("opportunity", "gsc", "a c"),
    );
  });

  it("surfaces missing report sections as data-quality gaps", () => {
    const report = weeklyReport([
      {
        key: "opportunities",
        title: "Opportunities",
        summary: "No opportunities found",
        rows: [],
        notes: ["no GSC query rows were provided; opportunities are empty"],
      },
      {
        key: "issues",
        title: "Issues by severity",
        summary: "No issues reported",
        rows: [],
        notes: ["no issue rows were provided"],
      },
    ]);

    const recommendations = buildRecommendations(report, null);
    expect(recommendations.map((item) => item.title).sort()).toEqual([
      "No crawl issue rows in the weekly report",
      "No query rows for opportunities",
    ]);
    expect(recommendations.every((item) => item.severity === "medium")).toBe(
      true,
    );
    expect(recommendations.map((item) => item.provider).sort()).toEqual([
      "crawl",
      "gsc",
    ]);
  });

  it("maps severities deterministically", () => {
    expect(normalizeSeverity("CRITICAL")).toBe("critical");
    expect(normalizeSeverity("unknown")).toBe("medium");
    expect(normalizeSeverity(undefined)).toBe("medium");
    expect(opportunitySeverity("decay", null)).toBe("medium");
    expect(opportunitySeverity("decay", 9)).toBe("medium");
    expect(opportunitySeverity("decay", 10)).toBe("high");
    expect(opportunitySeverity("striking_distance", null)).toBe("medium");
    expect(opportunitySeverity("striking_distance", 4)).toBe("low");
    expect(opportunitySeverity("striking_distance", 5)).toBe("medium");
    expect(opportunitySeverity("striking_distance", 25)).toBe("high");
  });

  it("returns nothing when both inputs are absent", () => {
    expect(buildRecommendations(null, null)).toEqual([]);
  });
});
