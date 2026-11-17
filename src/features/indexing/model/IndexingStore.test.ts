import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { IndexingStore } from "./IndexingStore";

const CONFIG = "C:\\ws\\seo.toml";
const TOKEN = "1700000000:abcdef0123";

function success(data: unknown, warnings: string[] = []): Envelope<unknown> {
  return { ok: true, data, meta: {}, warnings };
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

function storeWithMocks() {
  const submitSitemap = vi.fn();
  const submitIndexNow = vi.fn();
  const openScan = vi.fn();
  const store = new IndexingStore(submitSitemap, submitIndexNow, openScan);
  return { store, submitSitemap, submitIndexNow, openScan };
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

  it("drops both plans when the shared sitemap URL changes", async () => {
    const { store, submitSitemap, submitIndexNow } = storeWithMocks();
    submitSitemap.mockResolvedValueOnce(success(SITEMAP_PLAN));
    submitIndexNow.mockResolvedValueOnce(success(INDEXNOW_PLAN));

    await store.planSitemap(CONFIG);
    await store.planIndexNow(CONFIG);
    expect(store.sitemapState).toBe("planned");
    expect(store.indexNowState).toBe("planned");

    store.setSitemapUrl("https://example.com/other-sitemap.xml");
    expect(store.sitemapState).toBe("idle");
    expect(store.sitemapPlan).toBeNull();
    expect(store.indexNowState).toBe("idle");
    expect(store.indexNowPlan).toBeNull();
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
