import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import type { ReportDiff } from "@/entities/report/model/diff";
import { ReportDiffCard } from "./ReportDiffCard";

const DIFF: ReportDiff = {
  base: {
    property_id: "sc-domain:example.com",
    period: "2026-10-31..2026-11-06",
    headline: "Clicks up 12%",
  },
  head: {
    property_id: "sc-domain:example.com",
    period: "2026-11-07..2026-11-13",
    headline: "Clicks down 4%",
  },
  comparable: true,
  headline: [
    { metric: "clicks", base: 1000, head: 1120, abs_delta: 120, pct_delta: 12 },
  ],
  unknown_metrics: [],
  issues: [{ severity: "critical", base: 2, head: 1, delta: -1 }],
  opportunities: { added: [], resolved: [], unchanged: 0 },
  limitations_changed: { added: [], lifted: [] },
  limitations: [],
};

function render(overrides: Partial<Parameters<typeof ReportDiffCard>[0]> = {}) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <ReportDiffCard
        state="idle"
        diff={null}
        unavailable={null}
        error={null}
        warnings={[]}
        disabled={false}
        onCompare={() => {}}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe("ReportDiffCard", () => {
  it("shows a clear empty state when no previous snapshot exists", () => {
    const html = render({ state: "empty", unavailable: "not_enough_snapshots" });
    expect(html).toContain("No previous snapshot yet");
    expect(html).toContain("Build the weekly report for another period");
    expect(html).toContain("Retry");
    expect(html).not.toContain("Could not compare");
  });

  it("explains a missing local snapshot store", () => {
    const html = render({ state: "empty", unavailable: "no_store" });
    expect(html).toContain("No local snapshot store");
    expect(html).toContain("the engine creates the local store");
  });

  it("renders a real error with the engine message", () => {
    const html = render({
      state: "error",
      error: {
        code: "SHELL_UNAVAILABLE",
        message: "engine offline",
        retryable: true,
      },
    });
    expect(html).toContain("Could not compare the stored snapshots.");
    expect(html).toContain("engine offline");
  });

  it("offers the comparison before it is loaded", () => {
    const html = render();
    expect(html).toContain("Comparison not loaded");
    expect(html).toContain("Compare with previous");
  });

  it("renders the mapped diff rows when ready", () => {
    const html = render({ state: "ready", diff: DIFF });
    expect(html).toContain("2026-10-31 – 2026-11-06");
    expect(html).toContain("2026-11-07 – 2026-11-13");
    expect(html).toContain("Comparable");
    expect(html).toContain("Critical");
    expect(html).toContain("1,120");
  });
});
