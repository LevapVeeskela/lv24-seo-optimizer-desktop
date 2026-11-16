import { describe, expect, it } from "vitest";
import {
  crawlLimitations,
  normalizeCrawlResult,
  type CrawlMeta,
} from "./types";

const PAYLOAD = {
  summary: {
    start_url: "https://example.com/",
    site_url: "https://example.com",
    urls: 12,
    fetched: 10,
    errors: 1,
    blocked: 1,
    issues: 3,
    truncated: true,
    sitemap_urls: 8,
    sitemap_truncated: false,
    request_count: 15,
    request_budget: 500,
  },
  issues: [
    {
      rule_id: "title_missing",
      severity: "high",
      url: "https://example.com/a",
      detail: { title_length: 0 },
    },
    {
      rule_id: "thin_content",
      severity: "weird",
      url: "https://example.com/b",
      detail: "not-a-record",
    },
    { severity: "high", url: "https://example.com/no-rule" },
    { rule_id: "no_url", severity: "low" },
  ],
  errors: ["https://example.com/broken"],
  blocked: ["https://example.com/private"],
  sitemap_coverage: {
    counts: { unlinked: 2, missing_from_sitemap: 1, bad: "nope" },
    complete: false,
    truncated: true,
    limitations: ["crawl truncated: unlinked is a candidate list"],
  },
};

describe("normalizeCrawlResult", () => {
  it("maps summary counts, issues and coverage from the CLI payload", () => {
    const result = normalizeCrawlResult(PAYLOAD);

    expect(result.summary).toMatchObject({
      start_url: "https://example.com/",
      site_url: "https://example.com",
      urls: 12,
      fetched: 10,
      issues: 3,
      truncated: true,
      request_budget: 500,
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]).toEqual({
      rule_id: "title_missing",
      severity: "high",
      url: "https://example.com/a",
      detail: { title_length: 0 },
    });
    expect(result.issues[1]).toMatchObject({
      rule_id: "thin_content",
      severity: "unknown",
      detail: {},
    });
    expect(result.errors).toEqual(["https://example.com/broken"]);
    expect(result.blocked).toEqual(["https://example.com/private"]);
    expect(result.sitemap_coverage).toEqual({
      counts: { unlinked: 2, missing_from_sitemap: 1 },
      complete: false,
      truncated: true,
      limitations: ["crawl truncated: unlinked is a candidate list"],
    });
  });

  it("keeps missing counts unknown instead of turning them into zero", () => {
    const result = normalizeCrawlResult({ summary: { urls: "12" } });

    expect(result.summary.urls).toBeNull();
    expect(result.summary.fetched).toBeNull();
    expect(result.summary.truncated).toBeNull();
    expect(result.issues).toEqual([]);
    expect(result.sitemap_coverage).toBeNull();
  });

  it("survives a non-object payload without inventing evidence", () => {
    const result = normalizeCrawlResult(null);

    expect(result.issues).toEqual([]);
    expect(result.summary.start_url).toBeNull();
    expect(result.errors).toEqual([]);
  });
});

describe("crawlLimitations", () => {
  it("merges envelope and coverage limitations without duplicates", () => {
    const result = normalizeCrawlResult(PAYLOAD);
    const meta: CrawlMeta = {
      limitations: [
        "crawl truncated: unlinked is a candidate list",
        "no sitemap",
      ],
    };

    expect(crawlLimitations(result, meta)).toEqual([
      "crawl truncated: unlinked is a candidate list",
      "no sitemap",
    ]);
  });
});
