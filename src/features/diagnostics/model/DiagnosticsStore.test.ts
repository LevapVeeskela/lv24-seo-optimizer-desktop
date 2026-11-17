import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("../lib/ipc", () => ({
  runGscInspect: vi.fn(),
  runGscSitemaps: vi.fn(),
  runYandexIndexing: vi.fn(),
  runYandexSitemaps: vi.fn(),
  runYandexQueue: vi.fn(),
  runBingPages: vi.fn(),
  runBingTraffic: vi.fn(),
  runBingCrawl: vi.fn(),
  runBingUrlinfo: vi.fn(),
  runBingJoins: vi.fn(),
  runMetrikaPages: vi.fn(),
  runMetrikaGoals: vi.fn(),
  runMetrikaDevices: vi.fn(),
  runMetrikaCountries: vi.fn(),
  runMetrikaEngagement: vi.fn(),
  runMetrikaBytime: vi.fn(),
  runCwvAudits: vi.fn(),
  runCwvHistory: vi.fn(),
}));

import * as ipc from "../lib/ipc";
import { DiagnosticsStore } from "./DiagnosticsStore";

const CONFIG = "C:\\ws\\seo.toml";

function success(
  data: unknown,
  meta: Record<string, unknown> = {},
  warnings: string[] = [],
): Envelope<unknown> {
  return { ok: true, data, meta, warnings };
}

const runGscInspect = vi.mocked(ipc.runGscInspect);
const runGscSitemaps = vi.mocked(ipc.runGscSitemaps);
const runMetrikaPages = vi.mocked(ipc.runMetrikaPages);
const runCwvHistory = vi.mocked(ipc.runCwvHistory);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DiagnosticsStore", () => {
  it("refuses every read without an active config and never calls IPC", async () => {
    const store = new DiagnosticsStore();
    store.gscUrl = "https://example.com/";
    await expect(store.loadGscInspect(null)).resolves.toBe(false);
    expect(store.gscInspect.error?.code).toBe("CONFIG_PATH_REQUIRED");
    expect(runGscInspect).not.toHaveBeenCalled();
  });

  it("validates the URL before invoking the shell", async () => {
    const store = new DiagnosticsStore();
    store.gscUrl = "example.com/page";
    await expect(store.loadGscInspect(CONFIG)).resolves.toBe(false);
    expect(store.gscInspect.error?.code).toBe("INVALID_URL");
    expect(runGscInspect).not.toHaveBeenCalled();
  });

  it("loads and normalizes a GSC inspection", async () => {
    runGscInspect.mockResolvedValue(
      success(
        {
          inspection: {
            url: "https://example.com/",
            verdict: "PASS",
            coverage_state: "Submitted and indexed",
          },
        },
        { total: 1, truncated: false, limitations: ["one_url_per_call"] },
        ["read-only"],
      ),
    );
    const store = new DiagnosticsStore();
    store.gscUrl = " https://example.com/ ";
    store.gscLanguage = "en-US";
    await expect(store.loadGscInspect(CONFIG)).resolves.toBe(true);
    expect(runGscInspect).toHaveBeenCalledWith(
      { url: "https://example.com/", language: "en-US" },
      CONFIG,
    );
    expect(store.gscInspect.report?.verdict).toBe("PASS");
    expect(store.gscInspect.report?.meta.limitations).toContain(
      "one_url_per_call",
    );
    expect(store.gscInspect.warnings).toEqual(["read-only"]);
  });

  it("keeps the sitemap index optional", async () => {
    runGscSitemaps.mockResolvedValue(success({ rows: [] }));
    const store = new DiagnosticsStore();
    await store.loadGscSitemaps(CONFIG);
    expect(runGscSitemaps).toHaveBeenCalledWith({}, CONFIG);
  });

  it("rejects an out-of-range Metrika limit before IPC", async () => {
    const store = new DiagnosticsStore();
    store.metrikaLimit = 0;
    await expect(store.loadMetrikaPages(CONFIG)).resolves.toBe(false);
    expect(store.metrikaPages.error?.code).toBe("INVALID_LIMIT");
    expect(runMetrikaPages).not.toHaveBeenCalled();
  });

  it("sends only the selected CWV history target", async () => {
    runCwvHistory.mockResolvedValue(
      success({ periods: [] }, { limitations: ["low_traffic"] }),
    );
    const store = new DiagnosticsStore();
    store.cwvTargetMode = "origin";
    store.cwvHistoryOrigin = "https://example.com";
    store.cwvDevice = "all";
    store.cwvWeeks = 8;
    await expect(store.loadCwvHistory(CONFIG)).resolves.toBe(true);
    expect(runCwvHistory).toHaveBeenCalledWith(
      { origin: "https://example.com", weeks: 8 },
      CONFIG,
    );
    expect(store.cwvHistory.report?.meta.limitations).toContain(
      "low_traffic",
    );
  });

  it("drops a superseded answer instead of overwriting a newer one", async () => {
    let resolveFirst!: (value: Envelope<unknown>) => void;
    const firstAnswer = new Promise<Envelope<unknown>>((resolve) => {
      resolveFirst = resolve;
    });
    runGscInspect
      .mockImplementationOnce(() => firstAnswer)
      .mockResolvedValueOnce(
        success({ inspection: { url: "https://example.com/new" } }),
      );
    const store = new DiagnosticsStore();
    store.gscUrl = "https://example.com/old";
    const first = store.loadGscInspect(CONFIG);
    store.gscUrl = "https://example.com/new";
    await store.loadGscInspect(CONFIG);
    resolveFirst(success({ inspection: { url: "https://example.com/old" } }));
    await expect(first).resolves.toBe(false);
    expect(store.gscInspect.report?.url).toBe("https://example.com/new");
  });
});
