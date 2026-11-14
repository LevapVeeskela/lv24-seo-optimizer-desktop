import { describe, expect, it } from "vitest";
import {
  reportHtmlPath,
  reportLimitations,
  reportSections,
  type ReportMeta,
  type WeeklyReport,
} from "./types";

describe("report model helpers", () => {
  it("only exposes a non-empty HTML artifact path", () => {
    expect(reportHtmlPath({})).toBeNull();
    expect(reportHtmlPath({ artifacts: { html: "   " } })).toBeNull();
    expect(
      reportHtmlPath({ artifacts: { html: 42 } } as unknown as ReportMeta),
    ).toBeNull();
    expect(
      reportHtmlPath({
        artifacts: { html: "C:\\exports\\reports\\report.html" },
      }),
    ).toBe("C:\\exports\\reports\\report.html");
  });

  it("merges report and meta limitations without duplicates", () => {
    expect(
      reportLimitations(
        { limitations: ["one", "two", "one"] },
        { limitations: ["two", "three"] },
      ),
    ).toEqual(["one", "two", "three"]);
  });

  it("drops malformed sections instead of rendering partial rows", () => {
    const report = {
      sections: [
        { key: "headline", title: "Headline", summary: "", rows: [], notes: [] },
        { key: "traffic", rows: [] },
        null,
      ],
    } as unknown as WeeklyReport;

    expect(reportSections(report).map((section) => section.key)).toEqual([
      "headline",
    ]);
    expect(reportSections(null)).toEqual([]);
  });
});
