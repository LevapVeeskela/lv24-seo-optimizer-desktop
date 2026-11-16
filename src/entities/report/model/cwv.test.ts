import { describe, expect, it } from "vitest";
import type { ReportSection, WeeklyReport } from "./types";
import {
  formatCwvDelta,
  formatCwvP75,
  isCwvSection,
  mapCwvRow,
  parseCwv,
  reportCwvSection,
  type CwvRow,
} from "./cwv";

const SECTION: ReportSection = {
  key: "cwv",
  kind: "cwv",
  title: "Core Web Vitals",
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
      device: "DESKTOP",
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

function row(overrides: Partial<CwvRow> = {}): CwvRow {
  return {
    template: "/product/*",
    device: "phone",
    metric: "largest_contentful_paint",
    p75: 2500,
    unit: "ms",
    regression: true,
    delta: 180,
    deltaPct: null,
    ...overrides,
  };
}

describe("CWV section detection", () => {
  it("finds a section marked kind cwv", () => {
    const report: WeeklyReport = { sections: [SECTION] };
    expect(reportCwvSection(report)).toBe(SECTION);
    expect(isCwvSection(SECTION)).toBe(true);
  });

  it("accepts the legacy key-only shape but not a normal section", () => {
    const legacy: ReportSection = { ...SECTION, kind: undefined };
    expect(isCwvSection(legacy)).toBe(true);
    expect(
      isCwvSection({
        key: "traffic",
        title: "Traffic",
        summary: "",
        rows: [],
        notes: [],
      }),
    ).toBe(false);
  });

  it("returns null for an absent section or a report without sections", () => {
    expect(reportCwvSection(null)).toBeNull();
    expect(reportCwvSection({})).toBeNull();
    expect(parseCwv(null)).toBeNull();
  });
});

describe("CWV parsing", () => {
  it("maps template, device, metric, p75, regression and limitations", () => {
    const cwv = parseCwv(SECTION);
    expect(cwv).not.toBeNull();
    expect(cwv?.rows).toHaveLength(2);
    expect(cwv?.rows[0]).toEqual({
      template: "/product/*",
      device: "phone",
      metric: "largest_contentful_paint",
      p75: 2500,
      unit: "ms",
      regression: true,
      delta: 180,
      deltaPct: null,
    });
    expect(cwv?.rows[1].device).toBe("desktop");
    expect(cwv?.rows[1].unit).toBe("score");
    expect(cwv?.rows[1].regression).toBe(false);
    expect(cwv?.total).toBe(3);
    expect(cwv?.templates).toBe(2);
    expect(cwv?.truncated).toBe(true);
    expect(cwv?.dataAge).toBe("2026-11-10");
    expect(cwv?.limitations).toEqual([
      "Low-traffic templates have no field data.",
      "CrUX covers the origin, not every URL.",
    ]);
  });

  it("flattens the engine's template+metrics rows", () => {
    const cwv = parseCwv({
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
    });
    expect(cwv?.rows).toEqual([
      {
        template: "/blog/{id}",
        device: "phone",
        metric: "lcp",
        p75: 2800,
        unit: "ms",
        regression: true,
        delta: 300,
        deltaPct: 12,
      },
      {
        template: "/blog/{id}",
        device: "phone",
        metric: "cls",
        p75: 0.06,
        unit: "score",
        regression: false,
        delta: null,
        deltaPct: null,
      },
    ]);
    expect(cwv?.templates).toBe(1);
  });

  it("treats a missing baseline as unknown, not as stable", () => {
    const cwv = parseCwv({
      ...SECTION,
      rows: [
        {
          template: "/",
          device: "desktop",
          metrics: [
            {
              metric: "lcp",
              p75: 1900,
              unit: "ms",
              regressed: false,
              compared: 0,
            },
          ],
          regressed: false,
        },
      ],
      total: 1,
    });
    expect(cwv?.rows[0].regression).toBeNull();
  });

  it("skips rows without a template or a finite p75", () => {
    const cwv = parseCwv({
      ...SECTION,
      rows: [
        { template: "/ok/*", device: "phone", p75: 1200 },
        { device: "phone", p75: 900 },
        { template: "/bad/*", p75: "slow" },
      ],
    });
    expect(cwv?.rows).toHaveLength(1);
    expect(cwv?.skipped).toBe(2);
    expect(cwv?.total).toBe(3);
  });

  it("treats a numeric regression as the signed p75 delta", () => {
    const parsed = mapCwvRow({
      template: "/x/*",
      device: "tablet",
      p75: 3100,
      regression: 240,
    });
    expect(parsed?.regression).toBe(true);
    expect(parsed?.delta).toBe(240);
    expect(parsed?.unit).toBeNull();

    const improved = mapCwvRow({
      template: "/x/*",
      device: "mobile",
      p75: 1800,
      p75_delta: -120,
    });
    expect(improved?.device).toBe("phone");
    expect(improved?.regression).toBe(false);
    expect(improved?.delta).toBe(-120);
  });
});

describe("CWV formatting", () => {
  it("formats milliseconds and layout-shift scores", () => {
    expect(formatCwvP75(row(), "en")).toBe("2,500 ms");
    expect(
      formatCwvP75(
        row({ metric: "cumulative_layout_shift", p75: 0.082, unit: "score" }),
        "en",
      ),
    ).toBe("0.082");
    expect(formatCwvP75(row({ unit: null }), "en")).toBe("2,500");
  });

  it("signs the delta and keeps its unit", () => {
    expect(formatCwvDelta(row(), "en")).toBe("+180 ms");
    expect(formatCwvDelta(row({ delta: -120 }), "en")).toBe("-120 ms");
    expect(
      formatCwvDelta(row({ unit: "score", delta: 0.02 }), "en"),
    ).toBe("+0.02");
    expect(formatCwvDelta(row({ delta: null }), "en")).toBeNull();
  });
});
