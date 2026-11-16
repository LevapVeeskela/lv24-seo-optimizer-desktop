import { describe, expect, it } from "vitest";
import {
  diffChangedIssues,
  diffHasChanges,
  diffPeriodLabel,
  diffUnavailableReason,
  parseReportDiff,
} from "./diff";

const PAYLOAD = {
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
    { metric: "position", base: 4.2, head: 4.5, abs_delta: 0.3, pct_delta: 7.14 },
  ],
  unknown_metrics: ["ctr"],
  issues: [
    { severity: "critical", base: 2, head: 1, delta: -1 },
    { severity: "low", base: 5, head: 5, delta: 0 },
  ],
  opportunities: {
    added: [
      { kind: "ctr_boost", query: "buy seo", page: "https://example.com/a" },
    ],
    resolved: [],
    unchanged: 3,
  },
  limitations_changed: { added: ["gsc: quota reached"], lifted: [] },
  limitations: [
    "period lengths differ (7d vs 14d): metric deltas are not like-for-like",
  ],
  markdown: "### SEO report diff",
};

describe("parseReportDiff", () => {
  it("maps the engine payload without recomputing deltas", () => {
    const diff = parseReportDiff(PAYLOAD);
    expect(diff).not.toBeNull();
    expect(diff?.base.period).toBe("2026-10-31..2026-11-06");
    expect(diff?.head.headline).toBe("Clicks down 4%");
    expect(diff?.comparable).toBe(true);
    expect(diff?.headline).toEqual([
      { metric: "clicks", base: 1000, head: 1120, abs_delta: 120, pct_delta: 12 },
      {
        metric: "position",
        base: 4.2,
        head: 4.5,
        abs_delta: 0.3,
        pct_delta: 7.14,
      },
    ]);
    expect(diff?.unknown_metrics).toEqual(["ctr"]);
    expect(diff?.issues).toHaveLength(2);
    expect(diff?.opportunities.added[0]?.query).toBe("buy seo");
    expect(diff?.opportunities.unchanged).toBe(3);
    expect(diff?.limitations_changed.added).toEqual(["gsc: quota reached"]);
    expect(diff?.limitations).toHaveLength(1);
  });

  it("drops malformed rows instead of inventing numbers", () => {
    const diff = parseReportDiff({
      ...PAYLOAD,
      headline: [
        { metric: "clicks" },
        { metric: "ctr", base: null, head: 0.04, abs_delta: 0.04 },
        { base: 1, head: 2, abs_delta: 1 },
        null,
        ...PAYLOAD.headline,
      ],
      issues: [
        { severity: "high", base: "2", head: 1, delta: 1 },
        null,
        ...PAYLOAD.issues,
      ],
      opportunities: {
        ...PAYLOAD.opportunities,
        added: [null, { kind: "ctr_boost" }],
      },
      limitations_changed: { added: ["ok", 42], lifted: "nope" },
    });
    expect(diff?.headline.map((row) => row.metric)).toEqual([
      "clicks",
      "position",
    ]);
    expect(diff?.issues.map((row) => row.severity)).toEqual([
      "critical",
      "low",
    ]);
    expect(diff?.opportunities.added).toEqual([
      { kind: "ctr_boost", query: "", page: "" },
    ]);
    expect(diff?.limitations_changed).toEqual({ added: ["ok"], lifted: [] });
  });

  it("returns null when the payload has no snapshot identities", () => {
    expect(parseReportDiff(null)).toBeNull();
    expect(parseReportDiff({})).toBeNull();
    expect(parseReportDiff({ base: {}, head: null })).toBeNull();
    expect(parseReportDiff("not a diff")).toBeNull();
  });

  it("keeps the documented no-comparison payload as an empty diff", () => {
    const diff = parseReportDiff({
      base: { property_id: "p", period: "2026-10-01..2026-10-07", headline: null },
      head: { property_id: "p", period: "2026-10-08..2026-10-14", headline: null },
      comparable: false,
      headline: [],
      unknown_metrics: ["clicks", "impressions"],
      issues: [],
      opportunities: { added: [], resolved: [], unchanged: 0 },
      limitations_changed: { added: [], lifted: [] },
      limitations: [
        "one snapshot has no headline comparison (no comparable GSC windows): metric changes are unknown",
      ],
    });
    expect(diff?.comparable).toBe(false);
    expect(diffHasChanges(diff!)).toBe(false);
    expect(diffChangedIssues(diff!)).toEqual([]);
  });
});

describe("diff helpers", () => {
  const diff = parseReportDiff(PAYLOAD)!;

  it("reports only severity rows whose count moved", () => {
    expect(diffChangedIssues(diff)).toEqual([
      { severity: "critical", base: 2, head: 1, delta: -1 },
    ]);
  });

  it("detects changes and no-change snapshots", () => {
    expect(diffHasChanges(diff)).toBe(true);
    expect(
      diffHasChanges({
        ...diff,
        headline: [],
        issues: [],
        opportunities: { added: [], resolved: [], unchanged: 4 },
        limitations_changed: { added: [], lifted: [] },
      }),
    ).toBe(false);
  });

  it("renders the engine period label", () => {
    expect(diffPeriodLabel(diff.head)).toBe("2026-11-07 – 2026-11-13");
    expect(diffPeriodLabel({ ...diff.head, period: "last week" })).toBe(
      "last week",
    );
    expect(diffPeriodLabel({ ...diff.head, period: null })).toBeNull();
  });
});

describe("diffUnavailableReason", () => {
  it("turns the two expected failures into empty states", () => {
    expect(
      diffUnavailableReason({
        code: "INVALID_INPUT",
        message: "need two stored weekly snapshots for p; found 1",
      }),
    ).toBe("not_enough_snapshots");
    expect(
      diffUnavailableReason({
        code: "CONFIG_INVALID",
        message: "report diff needs stored snapshots",
      }),
    ).toBe("no_store");
  });

  it("keeps every other failure a real error", () => {
    expect(
      diffUnavailableReason({ code: "SHELL_UNAVAILABLE", message: "offline" }),
    ).toBeNull();
    expect(
      diffUnavailableReason({
        code: "INVALID_INPUT",
        message: "base period must be before head",
      }),
    ).toBeNull();
    expect(diffUnavailableReason({})).toBeNull();
  });
});
