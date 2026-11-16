import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { PortfolioStore } from "./PortfolioStore";
import type { PortfolioListFn } from "./PortfolioStore";

const NOW = () => new Date("2026-11-16T12:00:00Z");

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function ok(
  data: unknown,
  meta: Record<string, unknown> = {},
  warnings: string[] = [],
): Envelope<unknown> {
  return { ok: true, data, meta, warnings };
}

function site(configPath: string, total: number | null = null) {
  return {
    config_path: configPath,
    issues_open: total,
  };
}

describe("PortfolioStore", () => {
  it("loads sites, meta and limitations from portfolio_list", async () => {
    const list = vi.fn<PortfolioListFn>(async () =>
      ok(
        { sites: [site("/srv/a/seo.toml", 4), site("/srv/b/seo.toml", 0)] },
        { total: 2, limitations: ["Root scan is capped."] },
        ["slow disk"],
      ),
    );
    const store = new PortfolioStore(list, storage(), NOW);

    const loaded = await store.load("/srv/sites/");

    expect(loaded).toBe(true);
    expect(list).toHaveBeenCalledWith({ root: "/srv/sites", limit: 50 });
    expect(store.root).toBe("/srv/sites");
    expect(store.sites).toHaveLength(2);
    expect(store.issueTotal).toBe(4);
    expect(store.issueUnknownCount).toBe(0);
    expect(store.errorCount).toBe(0);
    expect(store.limitations).toEqual(["Root scan is capped."]);
    expect(store.warnings).toEqual(["slow disk"]);
    expect(store.state).toBe("ready");
    expect(store.lastLoadedAt).toBe("2026-11-16T12:00:00.000Z");
  });

  it("keeps the previous rows when a refresh fails", async () => {
    const list = vi
      .fn<PortfolioListFn>()
      .mockResolvedValueOnce(ok({ sites: [site("/srv/a/seo.toml", 2)] }))
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "CLI_FAILED", message: "engine stopped" },
        meta: {},
        warnings: ["retry later"],
      });
    const store = new PortfolioStore(list, storage(), NOW);

    await store.load("/srv/sites");
    const refreshed = await store.refresh();

    expect(refreshed).toBe(false);
    expect(store.sites).toHaveLength(1);
    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("CLI_FAILED");
    expect(store.warnings).toEqual(["retry later"]);
  });

  it("reports a payload without a site array as a contract error", async () => {
    const list = vi.fn<PortfolioListFn>(async () => ok({ rows: [] }));
    const store = new PortfolioStore(list, storage(), NOW);

    const loaded = await store.load("/srv/sites");

    expect(loaded).toBe(false);
    expect(store.error?.code).toBe("INVALID_PORTFOLIO_RESULT");
    expect(store.sites).toEqual([]);
    expect(store.state).toBe("error");
  });

  it("refuses to scan without a root and never calls the engine", async () => {
    const list = vi.fn<PortfolioListFn>();
    const store = new PortfolioStore(list, storage(), NOW);

    const loaded = await store.load();

    expect(loaded).toBe(false);
    expect(list).not.toHaveBeenCalled();
    expect(store.error?.code).toBe("PORTFOLIO_ROOT_MISSING");
  });

  it("ignores a response for a root the user already replaced", async () => {
    let resolveFirst: (value: Envelope<unknown>) => void = () => {};
    const first = new Promise<Envelope<unknown>>((resolve) => {
      resolveFirst = resolve;
    });
    const list = vi.fn<PortfolioListFn>(() => first);
    const store = new PortfolioStore(list, storage(), NOW);

    const pending = store.load("/srv/a");
    store.setRoot("/srv/b");
    resolveFirst(ok({ sites: [site("/srv/a/seo.toml", 9)] }));
    const loaded = await pending;

    expect(loaded).toBe(false);
    expect(store.root).toBe("/srv/b");
    expect(store.sites).toEqual([]);
  });

  it("clamps the requested limit to the engine contract", async () => {
    const list = vi.fn<PortfolioListFn>(async () => ok({ sites: [] }));
    const store = new PortfolioStore(list, storage(), NOW);

    await store.load("/srv/sites", 10_000);
    await store.load("/srv/sites", 0);

    expect(list).toHaveBeenNthCalledWith(1, { root: "/srv/sites", limit: 50 });
    expect(list).toHaveBeenNthCalledWith(2, { root: "/srv/sites", limit: 1 });
  });

  it("restores a remembered root and counts errored sites", async () => {
    const memory = storage();
    memory.setItem("lv24.portfolioRoot", "C:\\sites\\");
    const list = vi.fn<PortfolioListFn>(async () =>
      ok({
        sites: [
          { config_path: "C:\\sites\\a\\seo.toml", error: "invalid TOML" },
          { config_path: "C:\\sites\\b\\seo.toml" },
        ],
      }),
    );
    const store = new PortfolioStore(list, memory, NOW);

    expect(store.root).toBe("C:\\sites");
    await store.load();
    expect(store.errorCount).toBe(1);
    expect(store.issueUnknownCount).toBe(2);
    expect(store.sites[0].error).toBe("invalid TOML");
  });
});
