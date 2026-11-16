import { describe, expect, it, vi } from "vitest";
import { normalizeCrawlResult } from "@/entities/crawl";

vi.mock("@/shared/desktop/files", () => ({ writeTextFile: vi.fn() }));

import { writeTextFile } from "@/shared/desktop/files";
import {
  crawlExportFilename,
  exportCrawl,
  joinExportPath,
} from "./export";

const writeMock = vi.mocked(writeTextFile);
const NOW = new Date("2026-11-16T10:20:30Z");

const RESULT = normalizeCrawlResult({
  summary: {
    start_url: "https://Example.com/",
    site_url: "https://Example.com",
    urls: 1,
  },
  issues: [
    {
      rule_id: "title_missing",
      severity: "high",
      url: "https://example.com/a",
      detail: { page: "a" },
    },
  ],
});

describe("crawlExportFilename", () => {
  it("uses a sanitized host and a UTC timestamp", () => {
    expect(crawlExportFilename("json", "https://Example.com/x", NOW)).toBe(
      "crawl-example.com-20261116-102030.json",
    );
    expect(crawlExportFilename("csv", null, NOW)).toBe(
      "crawl-site-20261116-102030.csv",
    );
  });

  it("joins with the export root's separator", () => {
    expect(joinExportPath("C:\\exports\\", "a.csv")).toBe(
      "C:\\exports\\a.csv",
    );
    expect(joinExportPath("/home/me/exports/", "a.csv")).toBe(
      "/home/me/exports/a.csv",
    );
  });
});

describe("exportCrawl", () => {
  it("refuses to export without the app export root", async () => {
    const outcome = await exportCrawl({
      format: "json",
      result: RESULT,
      raw: { summary: {} },
      meta: {},
      warnings: [],
      exportDir: null,
      now: NOW,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("EXPORT_DIR_UNAVAILABLE");
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("writes JSON under the export root and reports the saved path", async () => {
    writeMock.mockResolvedValueOnce({
      path: "C:\\exports\\crawl-example.com-20261116-102030.json",
      bytes: 42,
    });
    const outcome = await exportCrawl({
      format: "json",
      result: RESULT,
      raw: { summary: { urls: 1 } },
      meta: { truncated: false },
      warnings: ["crawl: one warning"],
      exportDir: "C:\\exports",
      now: NOW,
    });

    expect(outcome).toEqual({
      status: "exported",
      path: "C:\\exports\\crawl-example.com-20261116-102030.json",
      bytes: 42,
    });
    expect(writeMock).toHaveBeenCalledOnce();
    const [path, content] = writeMock.mock.calls[0] ?? [];
    expect(path).toBe("C:\\exports\\crawl-example.com-20261116-102030.json");
    expect(content).toContain('"warnings"');
    expect(content).toContain('"data"');
  });

  it("writes every issue as CSV", async () => {
    writeMock.mockResolvedValueOnce({
      path: "C:\\exports\\crawl-example.com-20261116-102030.csv",
      bytes: 100,
    });
    const outcome = await exportCrawl({
      format: "csv",
      result: RESULT,
      raw: null,
      meta: {},
      warnings: [],
      exportDir: "C:\\exports",
      now: NOW,
    });

    expect(outcome.status).toBe("exported");
    const [, content] = writeMock.mock.calls[0] ?? [];
    expect(content).toContain("severity,rule_id,url,detail");
    expect(content).toContain("high,title_missing,https://example.com/a");
  });

  it("surfaces a denied write as a typed export error", async () => {
    writeMock.mockRejectedValueOnce({
      code: "PATH_NOT_ALLOWED",
      message: "path is outside the export root",
    });
    const outcome = await exportCrawl({
      format: "csv",
      result: RESULT,
      raw: null,
      meta: {},
      warnings: [],
      exportDir: "C:\\exports",
      now: NOW,
    });

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("PATH_NOT_ALLOWED");
    expect(outcome.error?.message).toContain("export root");
  });
});
