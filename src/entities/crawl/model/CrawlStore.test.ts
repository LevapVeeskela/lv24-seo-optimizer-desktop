import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { CrawlStore } from "./CrawlStore";

const runMock = vi.mocked(cliRun);

const PAYLOAD = {
  summary: {
    start_url: "https://example.com/",
    site_url: "https://example.com",
    urls: 2,
    fetched: 2,
    errors: 0,
    blocked: 0,
    issues: 1,
    truncated: false,
    sitemap_urls: 2,
    sitemap_truncated: false,
    request_count: 3,
    request_budget: 500,
  },
  issues: [
    {
      rule_id: "title_missing",
      severity: "high",
      url: "https://example.com/a",
      detail: { page: "a" },
    },
  ],
  errors: [],
  blocked: [],
  sitemap_coverage: {
    counts: {},
    complete: true,
    truncated: false,
    limitations: [],
  },
};

function success(data: unknown = PAYLOAD): Envelope<unknown> {
  return {
    ok: true,
    data,
    meta: { truncated: false, limitations: [] },
    warnings: ["crawl: robots.txt reachable"],
  };
}

describe("CrawlStore", () => {
  it("passes the run arguments to the allow-listed crawl command and maps the result", async () => {
    runMock.mockResolvedValueOnce(success());
    const store = new CrawlStore(() => new Date("2026-11-16T10:00:00Z"));

    expect(
      await store.run({ start: "https://example.com/", maxUrls: 250 }),
    ).toBe(true);

    expect(runMock).toHaveBeenCalledWith("crawl", {
      args: { start: "https://example.com/", maxUrls: 250 },
    });
    expect(store.state).toBe("ready");
    expect(store.result?.issues).toHaveLength(1);
    expect(store.result?.summary.issues).toBe(1);
    expect(store.meta.truncated).toBe(false);
    expect(store.warnings).toEqual(["crawl: robots.txt reachable"]);
    expect(store.lastRunAt).toBe("2026-11-16T10:00:00.000Z");
    expect(store.raw).toEqual(PAYLOAD);
  });

  it("keeps a clean crawl as a ready result with zero issues", async () => {
    runMock.mockResolvedValueOnce(
      success({ ...PAYLOAD, issues: [], summary: { ...PAYLOAD.summary, issues: 0 } }),
    );
    const store = new CrawlStore();

    expect(await store.run()).toBe(true);
    expect(store.state).toBe("ready");
    expect(store.result?.issues).toEqual([]);
    expect(store.error).toBeNull();
  });

  it("rejects an ok envelope without a data object", async () => {
    runMock.mockResolvedValueOnce({
      ok: true,
      data: null,
      meta: {},
      warnings: [],
    });
    const store = new CrawlStore();

    expect(await store.run()).toBe(false);
    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("INVALID_CRAWL_RESULT");
    expect(store.result).toBeNull();
  });

  it("keeps the previous result visible when a rerun fails", async () => {
    runMock.mockResolvedValueOnce(success());
    const store = new CrawlStore();
    expect(await store.run()).toBe(true);

    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFIG_INVALID", message: "bad base_url" },
      meta: {},
      warnings: [],
    });
    expect(await store.run()).toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("CONFIG_INVALID");
    expect(store.result?.issues).toHaveLength(1);
  });

  it("clears the result and ignores an in-flight run on reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const store = new CrawlStore();
    const run = store.run();
    expect(store.loading).toBe(true);

    store.reset();
    expect(store.state).toBe("idle");
    expect(store.result).toBeNull();

    resolve(success());
    expect(await run).toBe(false);
    expect(store.result).toBeNull();
    expect(store.state).toBe("idle");
  });
});
