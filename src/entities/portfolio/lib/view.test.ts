import { describe, expect, it } from "vitest";
import type { PortfolioSite } from "../model/types";
import {
  filterPortfolioSites,
  isPortfolioSort,
  sortPortfolioSites,
} from "./view";

function site(
  name: string,
  overrides: Partial<PortfolioSite> = {},
): PortfolioSite {
  return {
    configPath: `/srv/${name}/seo.toml`,
    name,
    property: `https://${name}.example/`,
    lastActivity: null,
    issues: { total: null, critical: null, all: null },
    error: null,
    ...overrides,
  };
}

describe("portfolio view", () => {
  it("filters by name, property and config path without case sensitivity", () => {
    const rows = [
      site("shop", { property: "https://store.example/" }),
      site("blog"),
    ];
    expect(filterPortfolioSites(rows, "SHOP").map((row) => row.name)).toEqual([
      "shop",
    ]);
    expect(
      filterPortfolioSites(rows, "store.example").map((row) => row.name),
    ).toEqual(["shop"]);
    expect(filterPortfolioSites(rows, "blog/seo").map((row) => row.name)).toEqual([
      "blog",
    ]);
    expect(filterPortfolioSites(rows, "   ")).toHaveLength(2);
  });

  it("sorts by open issues, newest activity and errors first", () => {
    const rows = [
      site("b", {
        issues: { total: 2, critical: 0, all: 2 },
        lastActivity: "2026-11-10T00:00:00Z",
      }),
      site("a", {
        issues: { total: 7, critical: 7, all: 7 },
        lastActivity: "2026-11-15T00:00:00Z",
        error: "invalid TOML",
      }),
      site("c"),
    ];

    expect(sortPortfolioSites(rows, "issues").map((row) => row.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      sortPortfolioSites(rows, "lastActivity").map((row) => row.name),
    ).toEqual(["a", "b", "c"]);
    expect(sortPortfolioSites(rows, "errors").map((row) => row.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortPortfolioSites(rows, "name").map((row) => row.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const rows = [site("b"), site("a")];
    const sorted = sortPortfolioSites(rows, "name");
    expect(rows.map((row) => row.name)).toEqual(["b", "a"]);
    expect(sorted.map((row) => row.name)).toEqual(["a", "b"]);
  });

  it("accepts only the offered sort keys", () => {
    expect(isPortfolioSort("issues")).toBe(true);
    expect(isPortfolioSort("errors")).toBe(true);
    expect(isPortfolioSort("random")).toBe(false);
    expect(isPortfolioSort(null)).toBe(false);
  });
});
