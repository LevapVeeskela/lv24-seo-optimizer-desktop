import { describe, expect, it } from "vitest";
import { mapPortfolioList, mapPortfolioMeta } from "./types";

/**
 * Payload copied from the engine's `portfolio list --json` contract
 * (`core/portfolio.py::SiteSummary.to_dict` / `PortfolioScan.meta`). Pinning it
 * here catches a field rename before the page silently shows empty rows.
 */
const ENGINE_DATA = {
  sites: [
    {
      config_path: "C:\\sites\\shop\\seo.toml",
      name: "Shop",
      property: "https://shop.example/",
      base_url: "https://shop.example",
      data_dir: "C:\\sites\\shop\\data",
      db_path: "C:\\sites\\shop\\data\\seo.sqlite3",
      db_present: true,
      crawl_runs: 3,
      last_crawl_at: "2026-11-14T10:00:00Z",
      report_snapshots: 2,
      last_report_at: "2026-11-15T09:00:00Z",
      last_report_period: "2026-11-04..2026-11-10",
      issues_open: 5,
      issues_total: 12,
      issues_critical: 2,
      last_issue_at: "2026-11-15T08:00:00Z",
      last_activity_at: "2026-11-15T09:00:00Z",
      error: null,
    },
    {
      config_path: "C:\\sites\\broken\\seo.toml",
      name: "",
      property: "",
      base_url: "",
      data_dir: null,
      db_path: null,
      db_present: false,
      crawl_runs: 0,
      last_crawl_at: null,
      report_snapshots: 0,
      last_report_at: null,
      last_report_period: null,
      issues_open: 0,
      issues_total: 0,
      issues_critical: 0,
      last_issue_at: null,
      last_activity_at: null,
      error: {
        code: "CONFIG_INVALID",
        message: "seo.toml is not valid TOML",
      },
    },
  ],
};

const ENGINE_META = {
  root: "C:\\sites",
  limit: 50,
  count: 2,
  total: 2,
  truncated: false,
  data_age_days: 0,
  read_only: true,
  max_depth: 3,
  limitations: [],
};

describe("portfolio_list engine contract", () => {
  it("maps the real site payload without losing the per-site error", () => {
    const mapping = mapPortfolioList(ENGINE_DATA);
    expect(mapping?.skipped).toBe(0);
    expect(mapping?.sites[0]).toEqual({
      configPath: "C:\\sites\\shop\\seo.toml",
      name: "Shop",
      property: "https://shop.example/",
      lastActivity: "2026-11-15T09:00:00Z",
      issues: { total: 5, critical: 2, all: 12 },
      error: null,
    });
    // An empty project name falls back to the folder name; the error stays.
    expect(mapping?.sites[1].name).toBe("broken");
    expect(mapping?.sites[1].error).toBe("seo.toml is not valid TOML");
  });

  it("maps the real meta block", () => {
    expect(mapPortfolioMeta(ENGINE_META, 2, 0)).toEqual({
      total: 2,
      truncated: false,
      dataAgeDays: 0,
      limitations: [],
    });
  });

  it("reports truncation when discovery exceeds the inspected rows", () => {
    const meta = mapPortfolioMeta(
      { ...ENGINE_META, total: 80, truncated: true, limitations: ["capped"] },
      50,
      0,
    );
    expect(meta.truncated).toBe(true);
    expect(meta.total).toBe(80);
    expect(meta.limitations).toEqual(["capped"]);
  });
});
