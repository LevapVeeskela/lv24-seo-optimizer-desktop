import { describe, expect, it, vi } from "vitest";
import { normalizeLogsResult } from "@/entities/logs";

vi.mock("@/shared/desktop/files", () => ({ writeTextFile: vi.fn() }));

import { writeTextFile } from "@/shared/desktop/files";
import { exportLogs } from "./export";

const writeMock = vi.mocked(writeTextFile);
const NOW = new Date("2026-11-16T10:20:30Z");

const RESULT = normalizeLogsResult({
  total_lines: 2,
  parsed_lines: 2,
  skipped_lines: 0,
  bot_daily: [
    {
      date: "2026-11-15",
      bot: "googlebot",
      status: "2xx",
      hits: 2,
      bytes: 300,
      p95_ms: 3,
    },
  ],
  crawl_waste: { hits: 1, bytes: 100, share: 0.5, total_hits: 2, by_bot: [] },
});

function input(format: "json" | "csv", exportDir: string | null) {
  return {
    format,
    file: "C:\\logs\\access.log",
    bot: "googlebot" as const,
    result: RESULT,
    meta: { limitations: ["bot classification is user-agent based"] },
    warnings: [] as string[],
    generatedAt: "2026-11-16T10:00:00.000Z",
    exportDir,
    now: NOW,
  };
}

describe("exportLogs", () => {
  it("refuses to export without the app export root", async () => {
    const outcome = await exportLogs(input("json", null));

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("EXPORT_DIR_UNAVAILABLE");
    expect(writeMock).not.toHaveBeenCalled();
  });

  it("writes JSON under the export root and reports the saved path", async () => {
    writeMock.mockResolvedValueOnce({
      path: "C:\\exports\\logs-access-20261116-102030.json",
      bytes: 42,
    });

    const outcome = await exportLogs(input("json", "C:\\exports"));

    expect(outcome).toEqual({
      status: "exported",
      path: "C:\\exports\\logs-access-20261116-102030.json",
      bytes: 42,
    });
    const [path, content] = writeMock.mock.calls[0] ?? [];
    expect(path).toBe("C:\\exports\\logs-access-20261116-102030.json");
    expect(content).toContain('"schema": "lv24-seo.logs/v1"');
    expect(content).toContain('"limitations"');
  });

  it("writes the daily table as CSV", async () => {
    writeMock.mockResolvedValueOnce({
      path: "C:\\exports\\logs-access-20261116-102030.csv",
      bytes: 20,
    });

    const outcome = await exportLogs(input("csv", "C:\\exports"));

    expect(outcome.status).toBe("exported");
    const [, content] = writeMock.mock.calls[0] ?? [];
    expect(content).toBe(
      "date,bot,status,hits,bytes,p95_ms\n2026-11-15,googlebot,2xx,2,300,3\n",
    );
  });

  it("surfaces a denied write as a typed export error", async () => {
    writeMock.mockRejectedValueOnce({
      code: "PATH_NOT_ALLOWED",
      message: "path is outside the export root",
    });

    const outcome = await exportLogs(input("csv", "C:\\exports"));

    expect(outcome.status).toBe("failed");
    expect(outcome.error?.code).toBe("PATH_NOT_ALLOWED");
    expect(outcome.error?.message).toContain("export root");
  });
});
