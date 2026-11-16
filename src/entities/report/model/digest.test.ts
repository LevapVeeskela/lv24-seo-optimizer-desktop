import { describe, expect, it } from "vitest";
import type { ReportSection, WeeklyReport } from "./types";
import {
  parseDigest,
  reportDigestSection,
  safeEvidenceUrl,
} from "./digest";

const SECTION: ReportSection = {
  key: "digest",
  kind: "digest",
  title: "Attributed change digest",
  summary: "2 material changes: 1 explained, 1 unexplained",
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
          change: "new",
        },
      ],
      next_action: "Fix the server error, then re-crawl.",
    },
    {
      metric: "position",
      change: { current: 4.2, previous: 3.8 },
      cause: "unexplained",
      confidence: "low",
      evidence: [],
      next_action: null,
    },
  ],
  notes: ["Only significant rows are explained."],
  total: 3,
  truncated: true,
  data_age: "2026-11-10",
  limitations: ["Digest evidence is capped."],
};

describe("digest parsing", () => {
  it("finds only a section explicitly marked kind=digest", () => {
    const report = {
      sections: [
        { key: "traffic", title: "Traffic", summary: "", rows: [], notes: [] },
        SECTION,
      ],
    } as unknown as WeeklyReport;
    expect(reportDigestSection(report)?.key).toBe("digest");
    expect(reportDigestSection({ sections: [] })).toBeNull();
    expect(reportDigestSection(null)).toBeNull();
  });

  it("maps causes, confidence, evidence and the section's own limitations", () => {
    const digest = parseDigest(SECTION);
    expect(digest).not.toBeNull();
    expect(digest?.items).toHaveLength(2);
    expect(digest?.items[0]).toMatchObject({
      metric: "clicks",
      cause: "new_crawl_issue",
      confidence: "high",
      nextAction: "Fix the server error, then re-crawl.",
    });
    expect(digest?.items[0].change).toEqual({
      current: 120,
      previous: 100,
      absDelta: 20,
      pctDelta: 20,
      direction: "up",
      good: true,
    });
    expect(digest?.items[0].evidence[0]).toMatchObject({
      kind: "crawl_issue",
      ruleId: "server-error",
      url: "https://example.com/a",
      severity: "high",
    });
    expect(digest?.items[1].confidence).toBe("low");
    expect(digest?.items[1].change.absDelta).toBeCloseTo(0.4);
    expect(digest?.total).toBe(3);
    expect(digest?.truncated).toBe(true);
    expect(digest?.dataAge).toBe("2026-11-10");
    expect(digest?.limitations).toEqual([
      "Digest evidence is capped.",
      "Only significant rows are explained.",
    ]);
  });

  it("returns null for an absent or non-digest section", () => {
    expect(parseDigest(null)).toBeNull();
    expect(
      parseDigest({
        key: "traffic",
        title: "Traffic",
        summary: "",
        rows: [],
        notes: [],
      }),
    ).toBeNull();
  });

  it("accepts the engine's key-only digest section until kind ships", () => {
    const digest = parseDigest({ ...SECTION, kind: undefined });
    expect(digest?.items).toHaveLength(2);
  });

  it("skips malformed rows and falls back honestly", () => {
    const digest = parseDigest({
      ...SECTION,
      rows: [{ metric: "" }, { metric: "ctr", cause: 42, confidence: "x" }],
      total: undefined,
      truncated: undefined,
    });
    expect(digest?.items).toHaveLength(1);
    expect(digest?.items[0].cause).toBe("unknown");
    expect(digest?.items[0].confidence).toBe("unknown");
    expect(digest?.items[0].change).toEqual({
      current: null,
      previous: null,
      absDelta: null,
      pctDelta: null,
      direction: null,
      good: null,
    });
    expect(digest?.skipped).toBe(1);
    expect(digest?.total).toBe(1);
    expect(digest?.truncated).toBe(false);
  });

  it("links only absolute http(s) evidence", () => {
    expect(safeEvidenceUrl("https://example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceUrl("https://user:pass@example.com/a")).toBeNull();
    expect(safeEvidenceUrl("/relative/path")).toBeNull();
    expect(safeEvidenceUrl(null)).toBeNull();
  });
});
