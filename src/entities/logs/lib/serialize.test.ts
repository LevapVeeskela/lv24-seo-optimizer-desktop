import { describe, expect, it } from "vitest";
import {
  LOGS_CSV_COLUMNS,
  csvCell,
  joinExportPath,
  logsCsv,
  logsExportFilename,
  logsJson,
} from "./serialize";
import { normalizeLogsResult } from "../model/types";

const NOW = new Date("2026-11-16T10:20:30Z");

const RESULT = normalizeLogsResult({
  total_lines: 10,
  parsed_lines: 9,
  skipped_lines: 1,
  bot_daily: [
    {
      date: "2026-11-15",
      bot: "googlebot",
      status: "2xx",
      hits: 5,
      bytes: 2048,
      p95_ms: 11.5,
    },
    {
      date: "2026-11-15",
      bot: "yandexbot",
      status: "4xx",
      hits: 1,
      bytes: null,
      p95_ms: null,
    },
  ],
  crawl_waste: {
    hits: 1,
    bytes: 0,
    share: 0.2,
    total_hits: 5,
    total_bytes: 2048,
    by_bot: [],
  },
});

describe("logsCsv", () => {
  it("writes the fixed header and one line per row", () => {
    const lines = logsCsv(RESULT.bot_daily).trimEnd().split("\n");
    expect(lines[0]).toBe(LOGS_CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("2026-11-15,googlebot,2xx,5,2048,11.5");
  });

  it("leaves a missing number empty instead of writing zero", () => {
    const [, , last] = logsCsv(RESULT.bot_daily).trimEnd().split("\n");
    expect(last).toBe("2026-11-15,yandexbot,4xx,1,,");
  });

  it("quotes a cell only when it needs it", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });
});

describe("logsJson", () => {
  it("carries the totals, the rollup, the waste split and limitations", () => {
    const parsed = JSON.parse(
      logsJson({
        file: "C:\\logs\\access.log",
        bot: "googlebot",
        result: RESULT,
        meta: {
          limitations: ["bot classification is user-agent based"],
        },
        warnings: ["skipped 1 of 10 lines", " "],
        generatedAt: "2026-11-16T10:20:30.000Z",
      }),
    ) as Record<string, unknown>;

    expect(parsed.schema).toBe("lv24-seo.logs/v1");
    expect(parsed.file).toBe("C:\\logs\\access.log");
    expect(parsed.bot).toBe("googlebot");
    expect(parsed.totals).toEqual({
      total_lines: 10,
      parsed_lines: 9,
      skipped_lines: 1,
    });
    expect(parsed.bot_daily).toHaveLength(2);
    expect(parsed.crawl_waste).toMatchObject({ hits: 1, share: 0.2 });
    expect(parsed.limitations).toEqual([
      "bot classification is user-agent based",
    ]);
    expect(parsed.warnings).toEqual(["skipped 1 of 10 lines"]);
    expect(parsed.generated_at).toBe("2026-11-16T10:20:30.000Z");
  });
});

describe("logsExportFilename", () => {
  it("uses the log file stem and a UTC timestamp", () => {
    expect(logsExportFilename("json", "C:\\logs\\access.log", NOW)).toBe(
      "logs-access-20261116-102030.json",
    );
    expect(logsExportFilename("csv", "/var/log/nginx/site-1.log", NOW)).toBe(
      "logs-site-1-20261116-102030.csv",
    );
  });

  it("sanitizes an untrusted file name and falls back to `log`", () => {
    expect(logsExportFilename("csv", "C:\\logs\\a b*c?.log", NOW)).toBe(
      "logs-a-b-c-20261116-102030.csv",
    );
    expect(logsExportFilename("json", null, NOW)).toBe(
      "logs-log-20261116-102030.json",
    );
  });

  it("joins with the export root's separator", () => {
    expect(joinExportPath("C:\\exports\\", "a.csv")).toBe("C:\\exports\\a.csv");
    expect(joinExportPath("/home/me/exports/", "a.csv")).toBe(
      "/home/me/exports/a.csv",
    );
    expect(joinExportPath("  ", "a.csv")).toBe("");
  });
});
