import { describe, expect, it } from "vitest";
import type { Recommendation } from "@/entities/recommendation/model/types";
import {
  matchesSearch,
  recommendationSearchText,
  sortRecommendations,
} from "./filter";

function recommendation(
  overrides: Partial<Recommendation> & Pick<Recommendation, "id">,
): Recommendation {
  return {
    category: "opportunity",
    severity: "medium",
    source: "gsc",
    title: `Title ${overrides.id}`,
    action: `Action ${overrides.id}`,
    verification: `Verify ${overrides.id}`,
    evidence: [{ key: "clicks", value: "12" }],
    ...overrides,
  };
}

const taskText = (item: Recommendation, field: "title" | "action" | "verification") =>
  `${field}:${item.id}`;
const sourceLabel = (source: string) => source.toUpperCase();

describe("matchesSearch", () => {
  it("requires every whitespace-separated term, case-insensitively", () => {
    expect(matchesSearch("decay queue clicks", "DECAY clicks")).toBe(true);
    expect(matchesSearch("decay queue clicks", "decay impressions")).toBe(false);
    expect(matchesSearch("anything", "   ")).toBe(true);
  });
});

describe("recommendationSearchText", () => {
  it("indexes the localised copy, the English brief, evidence and page", () => {
    const item = recommendation({
      id: "r1",
      page: "https://example.com/pricing",
      query: "seo tools",
      rule_ids: ["decay-title"],
    });
    const text = recommendationSearchText(item, taskText, sourceLabel, {
      severity: "Критично",
      category: "Возможность",
    });

    expect(text).toContain("title:r1");
    expect(text).toContain("action:r1");
    expect(text).toContain("https://example.com/pricing");
    expect(text).toContain("seo tools");
    expect(text).toContain("decay-title");
    expect(text).toContain("clicks 12");
    expect(text).toContain("gsc");
    expect(text).toContain("критично");
    expect(text).toContain("возможность");
  });
});

describe("sortRecommendations", () => {
  const items = [
    recommendation({ id: "low", severity: "low" }),
    recommendation({ id: "critical", severity: "critical" }),
    recommendation({ id: "medium", severity: "medium" }),
    recommendation({ id: "critical-2", severity: "critical" }),
  ];

  it("keeps report order by default", () => {
    expect(sortRecommendations(items, "report").map((item) => item.id)).toEqual([
      "low",
      "critical",
      "medium",
      "critical-2",
    ]);
  });

  it("sorts critical first and stays stable for ties", () => {
    expect(
      sortRecommendations(items, "severity-desc").map((item) => item.id),
    ).toEqual(["critical", "critical-2", "medium", "low"]);
  });

  it("sorts low first without mutating the input", () => {
    const sorted = sortRecommendations(items, "severity-asc");
    expect(sorted.map((item) => item.id)).toEqual([
      "low",
      "medium",
      "critical",
      "critical-2",
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "low",
      "critical",
      "medium",
      "critical-2",
    ]);
  });
});
