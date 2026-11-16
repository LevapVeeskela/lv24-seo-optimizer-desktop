import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import type { ReportSection } from "@/entities/report/model/types";
import { ReportDigestCard } from "./ReportDigestCard";

const SECTION: ReportSection = {
  key: "digest",
  kind: "digest",
  title: "Attributed change digest",
  summary: "1 material change: 1 with matching evidence",
  rows: [
    {
      metric: "clicks",
      change: {
        current: 120,
        previous: 100,
        abs_delta: 20,
        pct_delta: 20,
        direction: "up",
        good: true,
      },
      cause: "new_crawl_issue",
      confidence: "high",
      evidence: [
        {
          kind: "crawl_issue",
          rule_id: "server-error",
          url: "https://example.com/a",
          severity: "high",
        },
      ],
      next_action: "Fix the server error, then re-crawl.",
    },
  ],
  notes: [],
  total: 2,
  truncated: true,
  data_age: "2026-11-10",
  limitations: ["Digest evidence is capped."],
};

function render(section: ReportSection | null) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <ReportDigestCard section={section} />
    </I18nProvider>,
  );
}

describe("ReportDigestCard", () => {
  it("renders cause, confidence, change, evidence link and limitations", () => {
    const html = render(SECTION);
    expect(html).toContain("Attributed change digest");
    expect(html).toContain("New crawl issue");
    expect(html).toContain("High");
    expect(html).toContain("server-error");
    expect(html).toContain('href="https://example.com/a"');
    expect(html).toContain("Fix the server error, then re-crawl.");
    expect(html).toContain("Digest evidence is capped.");
    expect(html).toContain("Oldest evidence: 2026-11-10");
    expect(html).toContain("Showing 1 of 2 changes.");
  });

  it("renders nothing when the digest section is absent", () => {
    expect(render(null)).toBe("");
  });

  it("renders nothing for a normal report section", () => {
    expect(
      render({
        key: "traffic",
        title: "Traffic",
        summary: "",
        rows: [],
        notes: [],
      }),
    ).toBe("");
  });

  it("keeps an empty digest as an honest empty state", () => {
    const html = render({ ...SECTION, rows: [], total: 0, truncated: false });
    expect(html).toContain("No material metric change to explain.");
    expect(html).not.toContain("Could not");
  });

  it("never turns a javascript evidence URL into a link", () => {
    const html = render({
      ...SECTION,
      rows: [
        {
          ...SECTION.rows[0],
          evidence: [
            {
              kind: "crawl_issue",
              rule_id: "x",
              url: "javascript:alert(1)",
            },
          ],
        },
      ],
    });
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
  });
});
