import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  runBingCrawl,
  runBingJoins,
  runBingPages,
  runBingTraffic,
  runBingUrlinfo,
  runCwvAudits,
  runCwvHistory,
  runGscInspect,
  runGscSitemaps,
  runMetrikaBytime,
  runMetrikaCountries,
  runMetrikaDevices,
  runMetrikaEngagement,
  runMetrikaGoals,
  runMetrikaPages,
  runYandexIndexing,
  runYandexQueue,
  runYandexSitemaps,
} from "./ipc";

const invokeMock = vi.mocked(invoke);
const CONFIG = "C:\\ws\\seo.toml";

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue({
    ok: true,
    data: {},
    meta: {},
    warnings: [],
  });
});

function lastPayload(): Record<string, unknown> {
  const call = invokeMock.mock.calls.at(-1);
  expect(call?.[0]).toBe("cli_run");
  return call?.[1] as Record<string, unknown>;
}

describe("diagnostics IPC argument mapping", () => {
  it("maps Google reads to the allow-listed arguments", async () => {
    await runGscInspect(
      { url: "https://example.com/page", language: "ru-RU" },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "gsc_inspect",
      args: { url: "https://example.com/page", language: "ru-RU" },
      configPath: CONFIG,
    });

    await runGscInspect({ url: "https://example.com/page" }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "gsc_inspect",
      args: { url: "https://example.com/page" },
      configPath: CONFIG,
    });

    await runGscSitemaps(
      { sitemapIndex: "https://example.com/sitemap.xml" },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "gsc_sitemaps",
      args: { sitemapIndex: "https://example.com/sitemap.xml" },
      configPath: CONFIG,
    });
  });

  it("maps Yandex windows, paging and the queue", async () => {
    await runYandexIndexing(
      { dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "yandex_indexing",
      args: { dateFrom: "2026-11-01", dateTo: "2026-11-15" },
      configPath: CONFIG,
    });

    await runYandexSitemaps({ parentId: "42", limit: 50 }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "yandex_sitemaps",
      args: { parentId: "42", limit: 50 },
      configPath: CONFIG,
    });

    await runYandexQueue(
      {
        limit: 10,
        offset: 20,
        dateFrom: "2026-11-01",
        dateTo: "2026-11-15",
      },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "yandex_queue",
      args: {
        limit: 10,
        offset: 20,
        dateFrom: "2026-11-01",
        dateTo: "2026-11-15",
      },
      configPath: CONFIG,
    });
  });

  it("maps Bing reads without a site override", async () => {
    for (const [run, command] of [
      [runBingPages, "bing_pages"],
      [runBingTraffic, "bing_traffic"],
      [runBingCrawl, "bing_crawl"],
    ] as const) {
      await run(CONFIG);
      expect(lastPayload()).toEqual({ command, configPath: CONFIG });
    }

    await runBingUrlinfo({ url: "domain:example.com" }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "bing_urlinfo",
      args: { url: "domain:example.com" },
      configPath: CONFIG,
    });

    await runBingJoins(
      { query: "seo tools", page: "https://example.com/page" },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "bing_joins",
      args: {
        query: "seo tools",
        page: "https://example.com/page",
      },
      configPath: CONFIG,
    });
  });

  it("maps Metrika reads to one shared window shape", async () => {
    const input = { days: 28, lagDays: 3, limit: 50 };
    for (const [run, command] of [
      [runMetrikaPages, "metrika_pages"],
      [runMetrikaGoals, "metrika_goals"],
      [runMetrikaDevices, "metrika_devices"],
      [runMetrikaCountries, "metrika_countries"],
      [runMetrikaEngagement, "metrika_engagement"],
    ] as const) {
      await run(input, CONFIG);
      expect(lastPayload()).toEqual({
        command,
        args: input,
        configPath: CONFIG,
      });
    }

    await runMetrikaBytime({ ...input, group: "week" }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "metrika_bytime",
      args: { ...input, group: "week" },
      configPath: CONFIG,
    });
  });

  it("maps CWV audits and one history target", async () => {
    await runCwvAudits(
      {
        url: "https://example.com/",
        strategy: "desktop",
        category: ["performance", "seo"],
      },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "cwv_audits",
      args: {
        url: "https://example.com/",
        strategy: "desktop",
        category: ["performance", "seo"],
      },
      configPath: CONFIG,
    });

    await runCwvHistory(
      {
        origin: "https://example.com",
        device: "phone",
        weeks: 12,
      },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "cwv_history",
      args: {
        origin: "https://example.com",
        device: "phone",
        weeks: 12,
      },
      configPath: CONFIG,
    });
  });
});
