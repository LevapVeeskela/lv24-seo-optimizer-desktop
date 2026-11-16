import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { PropertiesStore } from "./PropertiesStore";

const runMock = vi.mocked(cliRun);

const DATA = {
  project: {
    name: "example.com",
    base_url: "https://example.com",
    default_property: "sc-domain:example.com",
  },
  providers: [
    {
      provider: "gsc",
      configured: true,
      target: "sc-domain:example.com",
      requires_token: true,
      token: "present",
      token_present: true,
      ready: true,
    },
  ],
};

function envelope(data: unknown): Envelope<unknown> {
  return { ok: true, data, meta: {}, warnings: [] };
}

describe("PropertiesStore", () => {
  it("loads and maps the engine payload once per workspace", async () => {
    runMock.mockResolvedValue(envelope(DATA));
    const store = new PropertiesStore();

    expect(await store.load("/srv/alpha/seo.toml")).toBe(true);
    expect(store.configuredRows).toHaveLength(1);
    expect(store.project?.baseUrl).toBe("https://example.com");

    expect(await store.load("/srv/alpha/seo.toml")).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(1);

    expect(await store.load("/srv/alpha/seo.toml", true)).toBe(true);
    expect(runMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous view visible when a refresh fails", async () => {
    runMock.mockResolvedValueOnce(envelope(DATA));
    const store = new PropertiesStore();
    await store.load("/srv/alpha/seo.toml");

    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", message: "provider timeout" },
      meta: {},
      warnings: [],
    });
    expect(await store.refresh()).toBe(false);
    expect(store.error?.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(store.rows).toHaveLength(1);
  });

  it("drops an in-flight load when the workspace is reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const store = new PropertiesStore();
    const pending = store.load("/srv/alpha/seo.toml");
    expect(store.loading).toBe(true);

    store.reset();
    resolve(envelope(DATA));

    expect(await pending).toBe(false);
    expect(store.view).toBeNull();
    expect(store.state).toBe("idle");
  });
});
