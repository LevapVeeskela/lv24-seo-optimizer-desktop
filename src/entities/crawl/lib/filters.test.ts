import { describe, expect, it } from "vitest";
import type { CrawlIssue } from "../model/types";
import {
  CRAWL_FILTERS_DEFAULT,
  crawlIssueFacets,
  effectiveCrawlFilters,
  filterCrawlIssues,
  sortCrawlIssues,
} from "./filters";

const ISSUES: CrawlIssue[] = [
  {
    rule_id: "title_missing",
    severity: "high",
    url: "https://example.com/about",
    detail: { page: "about" },
  },
  {
    rule_id: "thin_content",
    severity: "low",
    url: "https://example.com/blog",
    detail: { words: 42 },
  },
  {
    rule_id: "title_missing",
    severity: "critical",
    url: "https://example.com/",
    detail: { template: "home" },
  },
  {
    rule_id: "image_alt_missing",
    severity: "medium",
    url: "https://example.com/gallery",
    detail: { images: 3 },
  },
];

describe("filterCrawlIssues", () => {
  it("combines severity, rule and text filters", () => {
    expect(
      filterCrawlIssues(ISSUES, {
        severity: "high",
        rule: "title_missing",
        query: "about",
      }),
    ).toHaveLength(1);

    expect(
      filterCrawlIssues(ISSUES, {
        ...CRAWL_FILTERS_DEFAULT,
        severity: "critical",
      }).map((issue) => issue.url),
    ).toEqual(["https://example.com/"]);
  });

  it("matches the search case-insensitively against rule, URL and detail", () => {
    expect(
      filterCrawlIssues(ISSUES, {
        ...CRAWL_FILTERS_DEFAULT,
        query: "GALLERY",
      }),
    ).toHaveLength(1);

    expect(
      filterCrawlIssues(ISSUES, {
        ...CRAWL_FILTERS_DEFAULT,
        query: "words",
      }).map((issue) => issue.rule_id),
    ).toEqual(["thin_content"]);
  });

  it("returns every issue for the default filters", () => {
    expect(filterCrawlIssues(ISSUES, CRAWL_FILTERS_DEFAULT)).toHaveLength(4);
  });
});

describe("crawlIssueFacets", () => {
  it("counts present values only, in severity order", () => {
    const facets = crawlIssueFacets(ISSUES);

    expect(facets.severities).toEqual([
      { value: "critical", count: 1 },
      { value: "high", count: 1 },
      { value: "medium", count: 1 },
      { value: "low", count: 1 },
    ]);
    expect(facets.rules).toEqual([
      { value: "image_alt_missing", count: 1 },
      { value: "thin_content", count: 1 },
      { value: "title_missing", count: 2 },
    ]);
  });

  it("drops a stale filter instead of hiding every row", () => {
    const facets = crawlIssueFacets(ISSUES);
    const effective = effectiveCrawlFilters(
      { severity: "unknown", rule: "removed_rule", query: "x" },
      facets,
    );

    expect(effective).toEqual({ severity: "all", rule: "all", query: "x" });
  });
});

describe("sortCrawlIssues", () => {
  it("orders critical first and keeps the input array untouched", () => {
    const sorted = sortCrawlIssues(ISSUES);

    expect(sorted.map((issue) => issue.severity)).toEqual([
      "critical",
      "high",
      "medium",
      "low",
    ]);
    expect(ISSUES[0]?.severity).toBe("high");
  });
});
