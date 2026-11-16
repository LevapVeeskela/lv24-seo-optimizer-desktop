import { describe, expect, it } from "vitest";
import {
  logBotValue,
  logStatusValue,
  logsLimitations,
  normalizeLogsResult,
} from "./types";

const PAYLOAD = {
  total_lines: 120,
  parsed_lines: 118,
  skipped_lines: 2,
  bot_daily: [
    {
      date: "2026-11-15",
      bot: "googlebot",
      status: "2xx",
      hits: 80,
      bytes: 4096,
      p95_ms: 120.5,
    },
    {
      date: "2026-11-15",
      bot: "yandexbot",
      status: "4xx",
      hits: 3,
      bytes: 512,
      p95_ms: 8,
    },
  ],
  crawl_waste: {
    hits: 9,
    bytes: 2048,
    share: 0.375,
    total_hits: 24,
    total_bytes: 8192,
    by_bot: [
      {
        bot: "googlebot",
        hits: 4,
        bytes: 1024,
        share: 0.25,
        total_hits: 16,
      },
    ],
  },
};

describe("normalizeLogsResult", () => {
  it("maps the engine payload into typed rows and waste totals", () => {
    const result = normalizeLogsResult(PAYLOAD);

    expect(result.total_lines).toBe(120);
    expect(result.parsed_lines).toBe(118);
    expect(result.skipped_lines).toBe(2);
    expect(result.bot_daily).toHaveLength(2);
    expect(result.bot_daily[0]).toEqual({
      date: "2026-11-15",
      bot: "googlebot",
      status: "2xx",
      hits: 80,
      bytes: 4096,
      p95_ms: 120.5,
    });
    expect(result.crawl_waste.share).toBe(0.375);
    expect(result.crawl_waste.by_bot[0]?.bot).toBe("googlebot");
  });

  it("keeps an unknown bot and status instead of promoting them", () => {
    const result = normalizeLogsResult({
      bot_daily: [
        { date: "2026-11-15", bot: "ahrefsbot", status: "9xx", hits: 1 },
      ],
    });

    expect(result.bot_daily[0]?.bot).toBe("unknown");
    expect(result.bot_daily[0]?.status).toBe("unknown");
    expect(result.bot_daily[0]?.bytes).toBeNull();
    expect(result.bot_daily[0]?.p95_ms).toBeNull();
  });

  it("drops rows without a date and tolerates a malformed payload", () => {
    expect(normalizeLogsResult(null).bot_daily).toEqual([]);
    expect(
      normalizeLogsResult({
        bot_daily: [{ bot: "googlebot", hits: 2 }, "nope", { date: "2026-11-15" }],
      }).bot_daily,
    ).toHaveLength(1);
  });

  it("reads the helpers defensively", () => {
    expect(logBotValue("bingbot")).toBe("bingbot");
    expect(logBotValue(42)).toBe("unknown");
    expect(logStatusValue("3xx")).toBe("3xx");
    expect(logStatusValue(null)).toBe("unknown");
  });
});

describe("logsLimitations", () => {
  it("de-duplicates and trims the envelope limitations", () => {
    expect(
      logsLimitations({
        limitations: [
          "bot classification is user-agent based",
          "  ",
          "bot classification is user-agent based",
          "only nginx JSON logs are parsed",
        ],
      }),
    ).toEqual([
      "bot classification is user-agent based",
      "only nginx JSON logs are parsed",
    ]);
    expect(logsLimitations({})).toEqual([]);
  });
});
