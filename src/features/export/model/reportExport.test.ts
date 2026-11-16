import { describe, expect, it } from "vitest";
import type { ReportMeta, WeeklyReport } from "@/entities/report/model/types";
import {
  REPORT_CSV_COLUMNS,
  buildReportCsv,
  buildReportExportJson,
  csvCell,
  joinExportPath,
  reportExportFilename,
  reportExportRows,
} from "./reportExport";

const REPORT: WeeklyReport = {
  kind: "weekly",
  property_id: "sc-domain:example.com",
  period: { start: "2026-11-07", end: "2026-11-13" },
  generated_at: "2026-11-14T06:00:00Z",
  headline: "Clicks up 12%",
  sections: [
    {
      key: "headline",
      title: "Headline",
      summary: "2 significant changes",
      rows: [
        {
          metric: "clicks",
          current: 1120,
          previous: 1000,
          abs_delta: 120,
          pct_delta: 12,
        },
        { metric: "ctr", current: null, previous: null, abs_delta: null },
      ],
      notes: [],
    },
    {
      key: "traffic",
      title: "Traffic by engine",
      summary: "",
      rows: [{ engine: "gsc", rows: 1200, clicks: 900, position: 4.5 }],
      notes: [],
    },
    {
      key: "opportunities",
      title: "Opportunities",
      summary: "",
      rows: [
        {
          kind: "ctr_boost",
          query: "buy seo, cheap",
          page: "https://example.com/a?x=1&y=2",
          clicks: 12,
          expected_clicks: 40.5,
        },
      ],
      notes: [],
    },
    {
      key: "issues",
      title: "Issues by severity",
      summary: "",
      rows: [{ severity: "critical", count: 2, rule_ids: ["missing_title"] }],
      notes: [],
    },
    {
      key: "sources",
      title: "Sources",
      summary: "",
      rows: [{ source: "gsc", status: "rows", rows: 1200 }],
      notes: [],
    },
    {
      key: "examples",
      title: "Example URLs",
      summary: "",
      rows: [{ reason: "soft_404", url: "https://example.com/missing" }],
      notes: [],
    },
  ],
  limitations: ["period lengths differ (7d vs 14d), metric deltas are not like-for-like"],
  warnings: ["no GSC rows for one engine"],
};

const META: ReportMeta = {
  complete: true,
  truncated: false,
  data_age_days: 1,
  snapshot_hash: "abc123",
  limitations: ["period lengths differ (7d vs 14d), metric deltas are not like-for-like"],
};

describe("buildReportExportJson", () => {
  it("includes period, headline, sections and limitations", () => {
    const payload = JSON.parse(buildReportExportJson(REPORT, META));
    expect(payload.schema).toBe("lv24-seo.report/v1");
    expect(payload.kind).toBe("weekly");
    expect(payload.property_id).toBe("sc-domain:example.com");
    expect(payload.period).toEqual({ start: "2026-11-07", end: "2026-11-13" });
    expect(payload.headline).toBe("Clicks up 12%");
    expect(payload.sections).toHaveLength(6);
    expect(payload.sections[0].key).toBe("headline");
    expect(payload.limitations).toEqual([
      "period lengths differ (7d vs 14d), metric deltas are not like-for-like",
    ]);
    expect(payload.warnings).toEqual(["no GSC rows for one engine"]);
    expect(payload.meta).toEqual({
      complete: true,
      truncated: false,
      data_age_days: 1,
      snapshot_hash: "abc123",
    });
  });

  it("is byte-stable and marks unknown meta honestly", () => {
    const first = buildReportExportJson(REPORT, {});
    expect(buildReportExportJson(REPORT, {})).toBe(first);
    const payload = JSON.parse(first);
    expect(payload.meta).toEqual({
      complete: null,
      truncated: null,
      data_age_days: null,
      snapshot_hash: null,
    });
  });

  it("handles an empty report without inventing data", () => {
    const payload = JSON.parse(buildReportExportJson(null, {}));
    expect(payload.period).toBeNull();
    expect(payload.headline).toBeNull();
    expect(payload.sections).toEqual([]);
    expect(payload.limitations).toEqual([]);
  });
});

describe("buildReportCsv", () => {
  it("emits the documented flat row shape", () => {
    const lines = buildReportCsv(REPORT, META).trimEnd().split("\n");
    expect(lines[0]).toBe(REPORT_CSV_COLUMNS.join(","));
    expect(lines).toContain("headline,clicks,1120,120");
    expect(lines).toContain("traffic,gsc.rows,1200,");
    expect(lines).toContain("traffic,gsc.clicks,900,");
    expect(lines).toContain("issues,critical.count,2,");
    expect(lines).toContain("sources,gsc.rows,1200,");
    expect(lines).toContain("examples,soft_404,https://example.com/missing,");
    expect(lines).toContain(
      'opportunities,"ctr_boost:buy seo, cheap:https://example.com/a?x=1&y=2.clicks",12,',
    );
    expect(lines).toContain(
      'limitations,"period lengths differ (7d vs 14d), metric deltas are not like-for-like",,',
    );
    expect(lines).toContain("warnings,no GSC rows for one engine,,");
    // A headline row with no current value keeps its identity, not a fake 0.
    expect(lines).toContain("headline,ctr,,");
  });

  it("keeps every row flat with exactly four columns", () => {
    for (const row of reportExportRows(REPORT, META)) {
      expect(Object.keys(row).sort()).toEqual([
        "delta",
        "metric",
        "section",
        "value",
      ]);
    }
  });

  it("exports only the header for an empty report", () => {
    expect(buildReportCsv(null, {})).toBe("section,metric,value,delta\n");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
  });
});

describe("export filenames and paths", () => {
  it("uses the report period in the filename", () => {
    expect(reportExportFilename(REPORT, "json")).toBe(
      "weekly-report-2026-11-07_2026-11-13.json",
    );
    expect(reportExportFilename(REPORT, "csv")).toBe(
      "weekly-report-2026-11-07_2026-11-13.csv",
    );
    expect(reportExportFilename(null, "json")).toBe("weekly-report.json");
    expect(
      reportExportFilename(
        { period: { start: "2026/11/07", end: "2026/11/13" } },
        "csv",
      ),
    ).toBe("weekly-report-2026-11-07_2026-11-13.csv");
  });

  it("joins the export root with its own separator", () => {
    expect(joinExportPath("C:\\Users\\me\\exports\\", "report.json")).toBe(
      "C:\\Users\\me\\exports\\report.json",
    );
    expect(joinExportPath("/home/me/exports/", "report.csv")).toBe(
      "/home/me/exports/report.csv",
    );
    expect(joinExportPath("   ", "report.json")).toBe("");
  });
});
