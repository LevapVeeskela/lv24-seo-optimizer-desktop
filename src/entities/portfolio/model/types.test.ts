import { describe, expect, it } from "vitest";
import {
  PORTFOLIO_ROOT_KEY,
  mapPortfolioList,
  mapPortfolioMeta,
  mapPortfolioSite,
  normalizePortfolioRoot,
  readStoredRoot,
  writeStoredRoot,
} from "./types";

describe("portfolio mapping", () => {
  it("maps a site with the engine's issue counters", () => {
    const site = mapPortfolioSite({
      config_path: "C:\\sites\\shop\\seo.toml",
      property: "https://shop.example/",
      last_activity_at: "2026-11-15T09:30:00Z",
      issues_open: 5,
      issues_total: 12,
      issues_critical: 2,
      error: null,
    });
    expect(site).toEqual({
      configPath: "C:\\sites\\shop\\seo.toml",
      name: "shop",
      property: "https://shop.example/",
      lastActivity: "2026-11-15T09:30:00Z",
      issues: { total: 5, critical: 2, all: 12 },
      error: null,
    });
  });

  it("keeps unknown counts null instead of inventing zero", () => {
    const site = mapPortfolioSite({ config_path: "/srv/blog/seo.toml" });
    expect(site?.issues).toEqual({
      total: null,
      critical: null,
      all: null,
    });
    expect(site?.property).toBeNull();
    expect(site?.lastActivity).toBeNull();
  });

  it("accepts a nested issues object from a future payload", () => {
    const site = mapPortfolioSite({
      config_path: "/srv/blog/seo.toml",
      issues: { open: 3, critical: 1, all: 8 },
    });
    expect(site?.issues).toEqual({ total: 3, critical: 1, all: 8 });
  });

  it("reads a per-site error object as its message", () => {
    const site = mapPortfolioSite({
      config_path: "/srv/broken/seo.toml",
      error: { code: "CONFIG_INVALID", message: "seo.toml is not valid TOML" },
    });
    expect(site?.error).toBe("seo.toml is not valid TOML");
  });

  it("drops a row without a config path and counts it as skipped", () => {
    expect(mapPortfolioSite({ name: "orphan" })).toBeNull();
    expect(
      mapPortfolioList({
        sites: [
          { config_path: "/srv/a/seo.toml" },
          { name: "orphan" },
        ],
      }),
    ).toEqual({
      sites: [expect.objectContaining({ configPath: "/srv/a/seo.toml" })],
      skipped: 1,
    });
  });

  it("accepts a bare site array and rejects a payload without sites", () => {
    expect(mapPortfolioList([{ config_path: "/srv/a/seo.toml" }])?.sites).toHaveLength(1);
    expect(mapPortfolioList({ rows: [] })).toBeNull();
    expect(mapPortfolioList(null)).toBeNull();
  });

  it("reports truncation and limitations from the envelope meta", () => {
    const meta = mapPortfolioMeta(
      {
        total: 40,
        truncated: true,
        data_age_days: 3,
        limitations: ["Root scan is capped at 500 sites.", ""],
      },
      10,
      1,
    );
    expect(meta).toEqual({
      total: 40,
      truncated: true,
      dataAgeDays: 3,
      limitations: ["Root scan is capped at 500 sites."],
    });
  });
});

describe("portfolio root", () => {
  it("strips trailing separators but keeps a filesystem root", () => {
    expect(normalizePortfolioRoot("C:\\sites\\")).toBe("C:\\sites");
    expect(normalizePortfolioRoot("/srv/sites//")).toBe("/srv/sites");
    expect(normalizePortfolioRoot("/")).toBe("/");
    expect(normalizePortfolioRoot("C:\\")).toBe("C:\\");
    expect(normalizePortfolioRoot("   ")).toBeNull();
  });

  it("persists and restores the chosen root", () => {
    const storage = new Map<string, string>();
    const adapter = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    expect(readStoredRoot(adapter)).toBeNull();
    writeStoredRoot(adapter, "C:\\sites\\");
    expect(storage.get(PORTFOLIO_ROOT_KEY)).toBe("C:\\sites\\");
    expect(readStoredRoot(adapter)).toBe("C:\\sites");
  });

  it("survives a storage backend that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredRoot(broken)).toBeNull();
    expect(() => writeStoredRoot(broken, "/srv")).not.toThrow();
  });
});
