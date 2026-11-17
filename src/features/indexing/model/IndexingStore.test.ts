import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { IndexingStore } from "./IndexingStore";

const CONFIG = "C:\\ws\\seo.toml";
const TOKEN = "1700000000:abcdef0123";

function success(
  data: unknown,
  warnings: string[] = [],
  meta: Record<string, unknown> = {},
): Envelope<unknown> {
  return { ok: true, data, meta, warnings };
}

function failure(code: string, message: string): Envelope<unknown> {
  return {
    ok: false,
    error: { code, message, retryable: false },
    meta: {},
    warnings: [],
  };
}

const SITEMAP_PLAN = {
  status: "dry_run",
  plan: {
    action: "sitemap_submit",
    target: "https://example.com/",
    summary: "submit sitemap https://example.com/sitemap.xml to bing",
    payload: {
      provider: "bing",
      url: "https://example.com/sitemap.xml",
      action: "submit",
    },
  },
  plan_hash: "sha256-plan",
  confirm_token: TOKEN,
  ttl_seconds: 300,
};

const INDEXNOW_PLAN = {
  status: "dry_run",
  plan: {
    action: "indexnow",
    target: "example.com",
    summary: "submit 3 URL(s) to IndexNow for example.com",
    payload: { host: "example.com", urls: ["https://example.com/a"] },
  },
  plan_hash: "sha256-indexnow",
  confirm_token: TOKEN,
  ttl_seconds: 300,
};

const BING_PLAN = {
  status: "dry_run",
  plan: {
    action: "bing_submit",
    target: "example.com",
    summary: "submit 2 URL(s) to Bing for example.com",
    payload: {
      batches: 1,
      urls: ["https://example.com/a", "https://example.com/b"],
    },
  },
  plan_hash: "sha256-bing",
  confirm_token: TOKEN,
  ttl_seconds: 300,
};

const BING_RESULT = {
  status: "applied",
  plan: BING_PLAN.plan,
  result: {
    site_url: "https://example.com/",
    status: "accepted",
    accepted: 2,
    submitted: 2,
    batches: 1,
    batch_size: 500,
    duplicates_removed: 0,
    quota_after: { daily_remaining: 98, monthly_remaining: 1396 },
  },
};

const SITEMAPS = {
  site_url: "https://example.com/",
  rows: [
    {
      url: "https://example.com/sitemap.xml",
      type: "Sitemap",
      status: "Success",
      last_crawled: "2026-11-10T10:00:00Z",
      url_count: 42,
      file_size: 1024,
    },
  ],
};

const ISSUES = {
  site_url: "https://example.com/",
  rows: [
    {
      url: "https://example.com/missing",
      http_code: 404,
      issues: 20,
      in_links: 7,
    },
  ],
};

const QUOTA = {
  site_url: "https://example.com/",
  quota: {
    daily_remaining: 100,
    monthly_remaining: 1400,
  },
};

function storeWithMocks() {
  const submitSitemap = vi.fn();
  const submitIndexNow = vi.fn();
  const openScan = vi.fn();
  const submitBing = vi.fn();
  const loadSitemaps = vi.fn();
  const loadIssues = vi.fn();
  const loadQuota = vi.fn();
  const store = new IndexingStore(
    submitSitemap,
    submitIndexNow,
    openScan,
    submitBing,
    loadSitemaps,
    loadIssues,
    loadQuota,
  );
  return {
    store,
    submitSitemap,
    submitIndexNow,
    openScan,
    submitBing,
    loadSitemaps,
    loadIssues,
    loadQuota,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("IndexingStore sitemap", () => {
  it("plans the engine default, confirms, then applies with both gates", async () => {
    const { store, submitSitemap } = storeWithMocks();
    submitSitemap
      .mockResolvedValueOnce(success(SITEMAP_PLAN))
      .mockResolvedValueOnce(
        success({ status: "applied", plan: SITEMAP_PLAN.plan }),
      );

    expect(await store.planSitemap(CONFIG)).toBe(true);
    expect(submitSitemap).toHaveBeenNthCalledWith(
      1,
      { provider: "bing", allowWrite: true },
      CONFIG,
    );
    expect(store.sitemapState).toBe("planned");
    expect(store.sitemapPlan?.planHash).toBe("sha256-plan");
    expect(store.sitemapReady).toBe(true);

    expect(store.requestSitemapApply()).toBe(true);
    expect(await store.confirmSitemap(CONFIG)).toBe(true);
    expect(submitSitemap).toHaveBeenNthCalledWith(
      2,
      { provider: "bing", allowWrite: true, confirm: TOKEN },
      CONFIG,
    );
    expect(store.sitemapState).toBe("applied");
    expect(store.sitemapOutcome?.status).toBe("applied");
    expect(store.sitemapOutcome?.plan?.target).toBe("https://example.com/");
  });

  it("sends an explicit sitemap URL on the plan and the apply", async () => {
    const { store, submitSitemap } = storeWithMocks();
    submitSitemap
      .mockResolvedValueOnce(success(SITEMAP_PLAN))
      .mockResolvedValueOnce(success({ status: "applied" }));
    store.setSitemapUrl("https://example.com/sitemap.xml");

    expect(await store.planSitemap(CONFIG)).toBe(true);
    expect(store.requestSitemapApply()).toBe(true);
    expect(await store.confirmSitemap(CONFIG)).toBe(true);
    expect(submitSitemap).toHaveBeenNthCalledWith(
      1,
      {
        provider: "bing",
        url: "https://example.com/sitemap.xml",
        allowWrite: true,
      },
      CONFIG,
    );
    expect(submitSitemap).toHaveBeenNthCalledWith(
      2,
      {
        provider: "bing",
        url: "https://example.com/sitemap.xml",
        allowWrite: true,
        confirm: TOKEN,
      },
      CONFIG,
    );
  });

  it("refuses an apply without the confirmation dialog", async () => {
    const { store, submitSitemap } = storeWithMocks();
    expect(await store.confirmSitemap(CONFIG)).toBe(false);
    expect(store.sitemapError?.code).toBe("INDEXING_NOT_CONFIRMED");
    expect(submitSitemap).not.toHaveBeenCalled();
  });

  it("rejects an invalid sitemap URL before IPC", async () => {
    const { store, submitSitemap } = storeWithMocks();
    store.setSitemapUrl("sitemap.xml");
    expect(await store.planSitemap(CONFIG)).toBe(false);
    expect(store.sitemapError?.code).toBe("INVALID_SITEMAP_URL");
    expect(store.sitemapUrlInvalid).toBe(true);
    expect(submitSitemap).not.toHaveBeenCalled();
  });

  it("shows AUTH_REQUIRED as a settings hint, not a success", async () => {
    const { store, submitSitemap } = storeWithMocks();
    submitSitemap.mockResolvedValueOnce(
      failure("AUTH_REQUIRED", "Bing Webmaster API key is missing"),
    );

    expect(await store.planSitemap(CONFIG)).toBe(false);
    expect(store.sitemapState).toBe("error");
    expect(store.sitemapPlan).toBeNull();
    expect(store.sitemapNeedsAuth).toBe(true);
    expect(store.sitemapError?.message).toContain("API key");
  });

  it("explains a pre-0.9.0 engine without faking a plan", async () => {
    const { store, submitSitemap } = storeWithMocks();
    submitSitemap.mockResolvedValueOnce(
      failure("CLI_INVALID_JSON", "cli_run returned no JSON"),
    );

    expect(await store.planSitemap(CONFIG)).toBe(false);
    expect(store.sitemapNeedsEngineUpdate).toBe(true);
    expect(store.sitemapReady).toBe(false);
  });

  it("drops all plans when the shared sitemap URL changes", async () => {
    const { store, submitSitemap, submitIndexNow, submitBing } =
      storeWithMocks();
    submitSitemap.mockResolvedValueOnce(success(SITEMAP_PLAN));
    submitIndexNow.mockResolvedValueOnce(success(INDEXNOW_PLAN));
    submitBing.mockResolvedValueOnce(success(BING_PLAN));
    store.setBingUrls("https://example.com/a");

    await store.planSitemap(CONFIG);
    await store.planIndexNow(CONFIG);
    await store.planBing(CONFIG);
    expect(store.sitemapState).toBe("planned");
    expect(store.indexNowState).toBe("planned");
    expect(store.bingState).toBe("planned");

    store.setSitemapUrl("https://example.com/other-sitemap.xml");
    expect(store.sitemapState).toBe("idle");
    expect(store.sitemapPlan).toBeNull();
    expect(store.indexNowState).toBe("idle");
    expect(store.indexNowPlan).toBeNull();
    expect(store.bingState).toBe("idle");
    expect(store.bingPlan).toBeNull();
  });
});

describe("IndexingStore IndexNow", () => {
  it("plans from the shared sitemap and reports the submitted count", async () => {
    const { store, submitIndexNow } = storeWithMocks();
    submitIndexNow
      .mockResolvedValueOnce(success(INDEXNOW_PLAN))
      .mockResolvedValueOnce(
        success({
          status: "applied",
          plan: INDEXNOW_PLAN.plan,
          result: {
            rows: [{ submitted: 42, site_url: "https://example.com/" }],
            meta: { total: 42 },
            warnings: [],
          },
        }),
      );
    store.setSitemapUrl("https://example.com/sitemap.xml");

    expect(await store.planIndexNow(CONFIG)).toBe(true);
    expect(submitIndexNow).toHaveBeenNthCalledWith(
      1,
      { sitemapUrl: "https://example.com/sitemap.xml", allowWrite: true },
      CONFIG,
    );
    expect(store.requestIndexNowApply()).toBe(true);
    expect(await store.confirmIndexNow(CONFIG)).toBe(true);
    expect(submitIndexNow).toHaveBeenNthCalledWith(
      2,
      {
        sitemapUrl: "https://example.com/sitemap.xml",
        allowWrite: true,
        confirm: TOKEN,
      },
      CONFIG,
    );
    expect(store.indexNowOutcome?.status).toBe("applied");
    expect(store.indexNowOutcome?.submitted).toBe(42);
  });

  it("keeps a failed apply in the error state and drops the token", async () => {
    const { store, submitIndexNow } = storeWithMocks();
    submitIndexNow
      .mockResolvedValueOnce(success(INDEXNOW_PLAN))
      .mockResolvedValueOnce(
        failure("CONFIRM_REQUIRED", "confirm token expired"),
      );
    await store.planIndexNow(CONFIG);
    store.requestIndexNowApply();

    expect(await store.confirmIndexNow(CONFIG)).toBe(false);
    expect(store.indexNowState).toBe("error");
    expect(store.indexNowPlan).toBeNull();
    expect(store.indexNowOutcome).toBeNull();
    expect(store.indexNowError?.code).toBe("CONFIRM_REQUIRED");
  });
});

describe("IndexingStore Site Scan", () => {
  it("opens only an absolute https site URL", async () => {
    const { store, openScan } = storeWithMocks();
    openScan.mockResolvedValue(
      "https://www.bing.com/webmasters/sitescan?siteUrl=https%3A%2F%2Fexample.com%2F",
    );
    store.setSiteUrl("http://example.com/");

    expect(await store.openSiteScan()).toBe(false);
    expect(store.siteScanError?.code).toBe("INVALID_SITE_URL");
    expect(openScan).not.toHaveBeenCalled();

    store.setSiteUrl("https://example.com/");
    expect(await store.openSiteScan()).toBe(true);
    expect(openScan).toHaveBeenCalledWith("https://example.com/");
    expect(store.siteScanState).toBe("opened");
    expect(store.siteScanOpenedUrl).toContain("bing.com/webmasters/sitescan");
  });

  it("surfaces an opener failure instead of claiming a scan started", async () => {
    const { store, openScan } = storeWithMocks();
    openScan.mockRejectedValue({
      code: "OPEN_URL",
      message: "cannot open the Bing Site Scan page",
    });
    store.setSiteUrl("https://example.com/");

    expect(await store.openSiteScan()).toBe(false);
    expect(store.siteScanState).toBe("error");
    expect(store.siteScanError?.code).toBe("OPEN_URL");
    expect(store.siteScanOpenedUrl).toBeNull();
  });
});

describe("IndexingStore Bing URL submission", () => {
  it("plans explicit URLs, then applies with the reviewed token", async () => {
    const { store, submitBing } = storeWithMocks();
    submitBing
      .mockResolvedValueOnce(
        success(BING_PLAN, [], {
          quota: { daily_remaining: 99, monthly_remaining: 1398 },
          limitations: ["The plan is capped at the engine URL limit."],
        }),
      )
      .mockResolvedValueOnce(success(BING_RESULT));
    store.setBingUrls(
      "https://example.com/a\n\nhttps://example.com/b\nhttps://example.com/a",
    );

    expect(store.bingUrls).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
    expect(await store.planBing(CONFIG)).toBe(true);
    expect(submitBing).toHaveBeenNthCalledWith(
      1,
      {
        provider: "bing",
        urls: ["https://example.com/a", "https://example.com/b"],
        allowWrite: true,
      },
      CONFIG,
    );
    expect(store.bingState).toBe("planned");
    expect(store.bingPlanCounts?.urls).toBe(2);
    expect(store.bingPlanCounts?.batches).toBe(1);
    expect(store.bingPlanCounts?.quota.dailyRemaining).toBe(99);
    expect(store.bingPlanCounts?.quota.monthlyRemaining).toBe(1398);

    expect(store.requestBingApply()).toBe(true);
    expect(await store.confirmBing(CONFIG)).toBe(true);
    expect(submitBing).toHaveBeenNthCalledWith(
      2,
      {
        provider: "bing",
        urls: ["https://example.com/a", "https://example.com/b"],
        allowWrite: true,
        confirm: TOKEN,
      },
      CONFIG,
    );
    expect(store.bingState).toBe("applied");
    expect(store.bingOutcome?.status).toBe("applied");
    expect(store.bingOutcomeCounts?.accepted).toBe(2);
    expect(store.bingOutcomeCounts?.batches).toBe(1);
    expect(store.bingOutcomeCounts?.quota.dailyRemaining).toBe(98);
    expect(store.bingOutcomeCounts?.quota.monthlyRemaining).toBe(1396);
  });

  it("plans from the shared sitemap and sends no explicit URL list", async () => {
    const { store, submitBing } = storeWithMocks();
    submitBing.mockResolvedValueOnce(success(BING_PLAN));
    store.setSitemapUrl("https://example.com/sitemap.xml");
    store.setBingFromSitemap(true);

    expect(await store.planBing(CONFIG)).toBe(true);
    expect(submitBing).toHaveBeenCalledWith(
      {
        provider: "bing",
        fromSitemap: true,
        sitemapUrl: "https://example.com/sitemap.xml",
        allowWrite: true,
      },
      CONFIG,
    );
    expect(store.bingState).toBe("planned");
  });

  it("refuses an invalid URL or an empty source before IPC", async () => {
    const { store, submitBing } = storeWithMocks();

    expect(await store.planBing(CONFIG)).toBe(false);
    expect(store.bingError?.code).toBe("BING_SUBMIT_SOURCE_REQUIRED");
    expect(submitBing).not.toHaveBeenCalled();

    store.setBingUrls("sitemap.xml");
    expect(await store.planBing(CONFIG)).toBe(false);
    expect(store.bingError?.code).toBe("INVALID_SUBMIT_URL");
    expect(store.bingInvalidUrls).toEqual(["sitemap.xml"]);
    expect(submitBing).not.toHaveBeenCalled();
  });

  it("keeps Bing's HTTP 400 ErrorCode message and never fakes success", async () => {
    const { store, submitBing } = storeWithMocks();
    submitBing.mockResolvedValueOnce(
      failure(
        "BING_API_ERROR",
        "Bing returned HTTP 400 ErrorCode: InvalidApiKey",
      ),
    );
    store.setBingUrls("https://example.com/a");

    expect(await store.planBing(CONFIG)).toBe(false);
    expect(store.bingState).toBe("error");
    expect(store.bingPlan).toBeNull();
    expect(store.bingOutcome).toBeNull();
    expect(store.bingError?.message).toContain("ErrorCode: InvalidApiKey");
  });
});

describe("IndexingStore Bing read-only views", () => {
  it("loads sitemaps, crawl issues and remaining quota", async () => {
    const { store, loadSitemaps, loadIssues, loadQuota } = storeWithMocks();
    loadSitemaps.mockResolvedValueOnce(
      success(SITEMAPS, [], {
        limitations: ["Bing does not return per-URL crawl status."],
      }),
    );
    loadIssues.mockResolvedValueOnce(success(ISSUES));
    loadQuota.mockResolvedValueOnce(
      success(QUOTA, [], {
        limitations: ["The monthly reset is undocumented."],
      }),
    );

    expect(await store.loadBingSitemaps(CONFIG)).toBe(true);
    expect(loadSitemaps).toHaveBeenCalledWith(CONFIG);
    expect(store.sitemapsState).toBe("loaded");
    expect(store.sitemapsReport?.rows[0]).toEqual({
      url: "https://example.com/sitemap.xml",
      status: "Success",
      lastCrawled: "2026-11-10T10:00:00Z",
      urlCount: 42,
    });
    expect(store.sitemapsReport?.limitations).toContain(
      "Bing does not return per-URL crawl status.",
    );

    expect(await store.loadBingIssues(CONFIG)).toBe(true);
    expect(loadIssues).toHaveBeenCalledWith(CONFIG);
    expect(store.issuesReport?.rows[0]).toEqual({
      url: "https://example.com/missing",
      httpCode: 404,
      issues: 20,
      inLinks: 7,
    });

    expect(await store.loadBingQuota(CONFIG)).toBe(true);
    expect(loadQuota).toHaveBeenCalledWith(CONFIG);
    expect(store.quotaReport?.dailyRemaining).toBe(100);
    expect(store.quotaReport?.monthlyRemaining).toBe(1400);
    expect(store.quotaReport?.limitations).toContain(
      "The monthly reset is undocumented.",
    );
  });

  it("shows a missing key as an error and leaves the list empty", async () => {
    const { store, loadSitemaps } = storeWithMocks();
    loadSitemaps.mockResolvedValueOnce(
      failure("AUTH_REQUIRED", "Bing Webmaster API key is missing"),
    );

    expect(await store.loadBingSitemaps(CONFIG)).toBe(false);
    expect(store.sitemapsState).toBe("error");
    expect(store.sitemapsReport).toBeNull();
    expect(store.sitemapsError?.code).toBe("AUTH_REQUIRED");
    expect(store.sitemapsError?.message).toContain("API key");
  });

  it("requires a workspace before reading any Bing view", async () => {
    const { store, loadSitemaps, loadIssues, loadQuota } = storeWithMocks();

    expect(await store.loadBingSitemaps(null)).toBe(false);
    expect(await store.loadBingIssues(null)).toBe(false);
    expect(await store.loadBingQuota(null)).toBe(false);
    expect(store.sitemapsError?.code).toBe("CONFIG_PATH_REQUIRED");
    expect(store.issuesError?.code).toBe("CONFIG_PATH_REQUIRED");
    expect(store.quotaError?.code).toBe("CONFIG_PATH_REQUIRED");
    expect(loadSitemaps).not.toHaveBeenCalled();
    expect(loadIssues).not.toHaveBeenCalled();
    expect(loadQuota).not.toHaveBeenCalled();
  });
});
