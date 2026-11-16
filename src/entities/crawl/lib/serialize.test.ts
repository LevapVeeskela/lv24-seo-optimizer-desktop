import { describe, expect, it } from "vitest";
import type { CrawlIssue } from "../model/types";
import {
  CRAWL_CSV_COLUMNS,
  crawlIssuesCsv,
  crawlResultJson,
  csvCell,
  issueDetailJson,
  issueDetailText,
} from "./serialize";

const ISSUES: CrawlIssue[] = [
  {
    rule_id: "title_missing",
    severity: "high",
    url: "https://example.com/a,b",
    detail: { title: 'He said "hi"', note: "line\nbreak" },
  },
  {
    rule_id: "thin_content",
    severity: "low",
    url: "https://example.com/plain",
    detail: {},
  },
];

describe("csvCell", () => {
  it("quotes commas, quotes and newlines per RFC 4180", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
});

describe("crawlIssuesCsv", () => {
  it("writes a stable header and one CRLF-terminated row per issue", () => {
    const csv = crawlIssuesCsv(ISSUES);
    const lines = csv.split("\r\n");

    expect(lines[0]).toBe(CRAWL_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe(
      'high,title_missing,"https://example.com/a,b","{""note"":""line\\nbreak"",""title"":""He said \\""hi\\""""}"',
    );
    expect(lines[2]).toBe("low,thin_content,https://example.com/plain,{}");
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("exports the header only for an empty issue list", () => {
    expect(crawlIssuesCsv([])).toBe("severity,rule_id,url,detail\r\n");
  });
});

describe("issueDetailJson", () => {
  it("sorts keys so CSV diffs stay stable", () => {
    expect(issueDetailJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });
});

describe("crawlResultJson", () => {
  it("keeps the raw payload together with meta and warnings", () => {
    const raw = { summary: { urls: 1 }, issues: [] };
    const text = crawlResultJson(raw, { truncated: true }, ["crawl: 1 error"]);
    const parsed = JSON.parse(text) as {
      ok: boolean;
      meta: unknown;
      warnings: string[];
      data: unknown;
    };

    expect(text.endsWith("\n")).toBe(true);
    expect(parsed).toEqual({
      ok: true,
      meta: { truncated: true },
      warnings: ["crawl: 1 error"],
      data: raw,
    });
  });
});

describe("issueDetailText", () => {
  it("renders sorted key/value pairs and truncates long evidence", () => {
    expect(issueDetailText({ b: 2, a: "x" })).toBe("a: x · b: 2");
    expect(issueDetailText({}, 10)).toBe("—");
    expect(issueDetailText({ a: "x".repeat(40) }, 20)).toHaveLength(20);
    expect(issueDetailText({ a: "x".repeat(40) }, 20).endsWith("…")).toBe(true);
  });
});
