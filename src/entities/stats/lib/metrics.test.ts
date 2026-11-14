import { describe, expect, it } from "vitest";
import {
  formatDelta,
  formatMetricValue,
  metricLabelKey,
  metricUnit,
} from "./metrics";

describe("stats metric formatting", () => {
  it("formats CTR as a percent and keeps unknown values unknown", () => {
    expect(formatMetricValue("ctr", 0.0266, "en")).toBe("2.66%");
    expect(formatMetricValue("ctr", 0.5, "en")).toBe("50%");
    expect(formatMetricValue("ctr", null, "en")).toBe("—");
    expect(formatMetricValue("clicks", undefined, "en")).toBe("—");
  });

  it("formats position and score units without turning them into percents", () => {
    expect(formatMetricValue("position", 8.44, "en")).toBe("8.4");
    expect(formatMetricValue("cumulative_layout_shift", 0.123, "en", "score")).toBe("0.12");
    expect(formatMetricValue("largest_contentful_paint", 2100, "en", "ms")).toBe("2,100 ms");
    expect(formatMetricValue("performance", 0.92, "en")).toBe("92%");
  });

  it("never fabricates a delta without both values", () => {
    expect(formatDelta("clicks", 100, null, "en")).toBeNull();
    expect(formatDelta("clicks", null, 90, "en")).toBeNull();
  });

  it("uses percentage points for CTR deltas", () => {
    const delta = formatDelta("ctr", 0.0266, 0.0224, "en");
    expect(delta).not.toBeNull();
    expect(delta?.unit).toBe("percentage_points");
    expect(delta?.text).toBe("+0.42");
    expect(delta?.tone).toBe("good");
  });

  it("treats a lower position as an improvement", () => {
    const better = formatDelta("position", 8.4, 9.2, "en");
    expect(better?.direction).toBe("down");
    expect(better?.tone).toBe("good");
    expect(better?.text).toBe("-0.8");

    const worse = formatDelta("position", 10.1, 9.2, "en");
    expect(worse?.tone).toBe("bad");
  });

  it("reports click growth as a percentage of the previous window", () => {
    const delta = formatDelta("clicks", 1284, 1048, "en");
    expect(delta?.direction).toBe("up");
    expect(delta?.tone).toBe("good");
    expect(delta?.text).toBe("+22.5");
    expect(delta?.unit).toBe("percent");
  });

  it("keeps unknown metric codes raw and their tone neutral", () => {
    expect(metricLabelKey("clicks")).toBe("metric.clicks");
    expect(metricLabelKey("custom_metric")).toBeNull();
    expect(formatDelta("custom_metric", 2, 1, "en")?.tone).toBe("neutral");
  });

  it("infers milliseconds for PSI timing metrics without explicit units", () => {
    expect(metricUnit("psi", "largest_contentful_paint")).toBe("ms");
    expect(metricUnit("psi", "interaction_to_next_paint")).toBe("ms");
    expect(metricUnit("psi", "first_contentful_paint")).toBe("ms");
    expect(metricUnit("psi", "server_response_time")).toBe("ms");
    expect(metricUnit("psi", "first_input_delay")).toBe("ms");
    expect(metricUnit("gsc", "largest_contentful_paint")).toBeUndefined();
  });

  it("handles the uppercase Web Vitals keys PSI also returns", () => {
    expect(metricLabelKey("LCP")).toBe("metric.largest_contentful_paint");
    expect(metricLabelKey("INP")).toBe("metric.interaction_to_next_paint");
    expect(metricLabelKey("CLS")).toBe("metric.cumulative_layout_shift");
    expect(metricLabelKey("TTFB")).toBe("metric.server_response_time");
    expect(metricLabelKey("FID")).toBe("metric.first_input_delay");

    expect(metricUnit("psi", "LCP")).toBe("ms");
    expect(metricUnit("psi", "INP")).toBe("ms");
    expect(formatMetricValue("LCP", 2100, "en", metricUnit("psi", "LCP"))).toBe(
      "2,100 ms",
    );
    expect(formatMetricValue("INP", 240, "en", metricUnit("psi", "INP"))).toBe(
      "240 ms",
    );

    // CLS is a unitless score, not a duration.
    expect(metricUnit("psi", "CLS")).toBeUndefined();
    expect(formatMetricValue("CLS", 0.123, "en", metricUnit("psi", "CLS"))).toBe(
      "0.12",
    );

    expect(formatDelta("LCP", 2100, 2500, "en")?.tone).toBe("good");
    expect(formatDelta("CLS", 0.2, 0.1, "en")?.tone).toBe("bad");
  });

  it("prefers explicit provider units over the PSI inference", () => {
    expect(
      metricUnit("psi", "largest_contentful_paint", {
        largest_contentful_paint: "s",
      }),
    ).toBe("s");
  });
});
