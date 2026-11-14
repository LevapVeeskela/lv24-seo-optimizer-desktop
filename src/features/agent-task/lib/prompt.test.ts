import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/entities/recommendation/model/types";
import { buildAgentPrompt } from "./prompt";

const PERIOD = { start: "2026-11-01", end: "2026-11-07" };

const recommendation: Recommendation = {
  id: "opportunity:gsc:seo-audit-1234",
  category: "opportunity",
  severity: "high",
  source: "gsc",
  provider: "gsc",
  title: 'Move "seo audit" from position 12.4 into the top results',
  action:
    "Strengthen the title, H1 and snippet of the ranking page for this query; align the content with search intent before requesting a recrawl.",
  verification:
    "Rebuild the weekly report for the same period after the page is recrawled and compare position and clicks for this query.",
  evidence: [
    { key: "position", value: "12.4" },
    { key: "impressions", value: "1200" },
  ],
  query: "seo audit",
  page: "https://example.com/seo-audit",
  expected_clicks: 36,
};

describe("buildAgentPrompt", () => {
  it("renders a complete, actionable Markdown brief", () => {
    const prompt = buildAgentPrompt(
      recommendation,
      "sc-domain:example.com",
      PERIOD,
    );

    expect(prompt).toContain("# Agent task:");
    expect(prompt).toContain("## Role");
    expect(prompt).toContain("- Property: sc-domain:example.com");
    expect(prompt).toContain("- Period: 2026-11-01");
    expect(prompt).toContain("2026-11-07");
    expect(prompt).toContain("- Source: Google Search Console");
    expect(prompt).toContain("- Provider: gsc");
    expect(prompt).toContain("- Query: seo audit");
    expect(prompt).toContain("- Page: https://example.com/seo-audit");
    expect(prompt).toContain("- Expected clicks/week");
    expect(prompt).toContain("36");

    expect(prompt).toContain("## Evidence");
    expect(prompt).toContain("- Position: 12.4");
    expect(prompt).toContain("- Impressions: 1200");
    expect(prompt).toContain("## Recommended action");
    expect(prompt).toContain(recommendation.action);
    expect(prompt).toContain("## Verification");
    expect(prompt).toContain(recommendation.verification);

    expect(prompt).toContain("## Constraints");
    expect(prompt).toContain("Read-only by default");
    expect(prompt).toContain("paid tools");
    expect(prompt).toContain("unrelated files");
    expect(prompt).toContain("Report exact changes");

    expect(prompt).toContain("## Relevant tools");
    expect(prompt).toContain("lv24-seo report weekly --json");
    expect(prompt).toContain("lv24-seo gsc query --start 2026-11-01");
    expect(prompt).toContain("gsc_search_analytics");
    expect(prompt).toContain("seo_opportunities");

    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
    expect(prompt).not.toContain("None");
  });

  it("redacts secret-looking values and leaves the property intact", () => {
    const secretRecommendation: Recommendation = {
      ...recommendation,
      action: "Use api_key: another-secret and fix the page.",
      evidence: [
        {
          key: "error_message",
          value: "request failed token=super-secret-123",
        },
        { key: "position", value: "12.4" },
      ],
    };

    const prompt = buildAgentPrompt(
      secretRecommendation,
      "sc-domain:example.com",
      PERIOD,
    );

    expect(prompt).not.toContain("super-secret-123");
    expect(prompt).not.toContain("another-secret");
    expect(prompt).toContain("[redacted]");
    expect(prompt).toContain("sc-domain:example.com");
  });

  it("keeps unknown property and period explicit instead of inventing values", () => {
    const prompt = buildAgentPrompt(recommendation, null, null);

    expect(prompt).toContain("- Property: Not reported");
    expect(prompt).toContain("- Period: Not reported");
    expect(prompt).toContain("<period-start>");
    expect(prompt).toContain("<period-end>");
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("null");
  });

  it("lists the tools that match the task category", () => {
    const crawl: Recommendation = {
      ...recommendation,
      category: "crawl",
      source: "crawl",
      provider: "crawl",
      title: "Fix 3 critical crawl issues",
      query: undefined,
      page: undefined,
      expected_clicks: undefined,
      rule_ids: ["broken_link", "missing_title"],
      count: 3,
    };
    const crawlPrompt = buildAgentPrompt(crawl, "sc-domain:example.com", PERIOD);
    expect(crawlPrompt).toContain("lv24-seo crawl --json");
    expect(crawlPrompt).toContain("seo_crawl_site");
    expect(crawlPrompt).toContain("- Rule IDs: broken_link, missing_title");

    const configuration: Recommendation = {
      ...recommendation,
      category: "configuration",
      source: "stats",
      provider: "gsc",
      title: "Connect Google Search Console: token missing",
      query: undefined,
      page: undefined,
      expected_clicks: undefined,
    };
    const configurationPrompt = buildAgentPrompt(
      configuration,
      "sc-domain:example.com",
      PERIOD,
    );
    expect(configurationPrompt).toContain("lv24-seo auth status --json");
    expect(configurationPrompt).toContain("lv24-seo properties --json");
    expect(configurationPrompt).toContain("seo_properties");

    const dataQuality: Recommendation = {
      ...configuration,
      category: "data_quality",
      title: "No Google Search Console data for this period",
    };
    const dataPrompt = buildAgentPrompt(
      dataQuality,
      "sc-domain:example.com",
      PERIOD,
    );
    expect(dataPrompt).toContain("lv24-seo stats --json");
    expect(dataPrompt).toContain("seo_weekly_report");
  });
});
