import { describe, expect, it } from "vitest";
import { formatDelta, formatMetricValue, metricLabelKey } from "./metrics";

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
});
