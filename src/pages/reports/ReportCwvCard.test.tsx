import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import type { ReportSection } from "@/entities/report/model/types";
import { ReportCwvCard } from "./ReportCwvCard";

const SECTION: ReportSection = {
  key: "cwv",
  kind: "cwv",
  title: "Core Web Vitals by template",
  summary: "2 templates with field data",
  rows: [
    {
      template: "/product/*",
      device: "phone",
      metric: "largest_contentful_paint",
      p75: 2500,
      regression: true,
      delta: 180,
    },
    {
      template: "/blog/*",
      device: "desktop",
      metric: "cumulative_layout_shift",
      p75: 0.08,
      regression: false,
    },
  ],
  notes: ["CrUX covers the origin, not every URL."],
  total: 3,
  truncated: true,
  data_age: "2026-11-10",
  limitations: ["Low-traffic templates have no field data."],
};

function render(section: ReportSection | null) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <ReportCwvCard section={section} />
    </I18nProvider>,
  );
}

describe("ReportCwvCard", () => {
  it("renders template, device, metric, p75, regression and limitations", () => {
    const html = render(SECTION);
    expect(html).toContain("Core Web Vitals by template");
    expect(html).toContain("2 templates with field data");
    expect(html).toContain("/product/*");
    expect(html).toContain("Phone");
    expect(html).toContain("Desktop");
    expect(html).toContain("LCP");
    expect(html).toContain("CLS");
    expect(html).toContain("2,500 ms");
    expect(html).toContain("+180 ms");
    expect(html).toContain("Regression");
    expect(html).toContain("No regression");
    expect(html).toContain("Showing 2 of 3 templates.");
    expect(html).toContain("Data age: 2026-11-10");
    expect(html).toContain("Low-traffic templates have no field data.");
    expect(html).toContain("CrUX covers the origin, not every URL.");
  });

  it("renders nothing when the CWV section is absent", () => {
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

  it("keeps an empty CWV section as an honest empty state", () => {
    const html = render({ ...SECTION, rows: [], total: 0, truncated: false });
    expect(html).toContain("No Core Web Vitals rows for this report.");
    expect(html).not.toContain("Regression");
  });

  it("accepts a numeric regression and omits the metric column when absent", () => {
    const html = render({
      ...SECTION,
      rows: [
        { template: "/checkout/*", device: "tablet", p75: 3100, regression: 240 },
        { template: "/home/*", device: "phone", p75: 1900, regression: 0 },
      ],
      total: 2,
      truncated: false,
      notes: [],
      limitations: [],
    });
    expect(html).toContain("/checkout/*");
    expect(html).toContain("+240");
    expect(html).toContain("No regression");
    expect(html).not.toContain(">Metric<");
  });

  it("renders the engine's template+metrics rows with a translated limitation", () => {
    const html = render({
      ...SECTION,
      rows: [
        {
          template: "/blog/{id}",
          device: "phone",
          urls: 4,
          sample: 10,
          coverage: 0.67,
          metrics: [
            {
              metric: "lcp",
              p75: 2800,
              unit: "ms",
              status: "needs_improvement",
              delta: 300,
              delta_pct: 12,
              regressed: true,
            },
            {
              metric: "cls",
              p75: 0.06,
              unit: "score",
              status: "good",
              regressed: false,
            },
          ],
          regressed: true,
          regression_pct: 12,
          regression_metric: "lcp",
          poor_metrics: 0,
        },
      ],
      total: 1,
      truncated: false,
      notes: [],
      limitations: ["cwv_p75_worst_page"],
    });
    expect(html).toContain("/blog/{id}");
    expect(html).toContain("2,800 ms");
    expect(html).toContain("+300 ms");
    expect(html).toContain("0.06");
    expect(html).toContain("A template p75 is the worst page p75");
    expect(html).not.toContain("cwv_p75_worst_page");
  });

  it("counts malformed rows instead of inventing values", () => {
    const html = render({
      ...SECTION,
      rows: [{ template: "/product/*", device: "phone", p75: 2500 }, { p75: 1 }],
      total: 2,
      truncated: false,
    });
    expect(html).toContain("1 malformed rows ignored.");
    expect(html).toContain("/product/*");
  });
});
