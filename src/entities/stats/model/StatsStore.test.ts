import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import type { StatsData } from "./types";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { StatsStore } from "./StatsStore";

const runMock = vi.mocked(cliRun);

const DATA: StatsData = {
  period: { start: "2026-11-07", end: "2026-11-13" },
  services: [],
  coverage: {
    configured: 1,
    returned: 1,
    failed: 0,
    missing: 0,
    complete: true,
  },
};

function envelope(data: StatsData): Envelope<StatsData> {
  return { ok: true, data, meta: {}, warnings: [] };
}

describe("StatsStore", () => {
  it("drops an in-flight refresh when the workspace is reset", async () => {
    let resolve!: (value: Envelope<StatsData>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const store = new StatsStore();
    const refresh = store.refresh();
    expect(store.loading).toBe(true);

    store.reset();
    expect(store.state).toBe("idle");

    resolve(envelope(DATA));
    expect(await refresh).toBe(false);
    expect(store.data).toBeNull();
    expect(store.state).toBe("idle");
    expect(store.lastUpdated).toBeNull();
  });

  it("keeps the previous numbers when a refresh fails, with the error visible", async () => {
    runMock.mockResolvedValueOnce(envelope(DATA));
    const store = new StatsStore();
    expect(await store.refresh()).toBe(true);

    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "UPSTREAM_UNAVAILABLE", message: "provider timeout" },
      meta: {},
      warnings: [],
    });
    expect(await store.refresh()).toBe(false);
    expect(store.data).toEqual(DATA);
    expect(store.error?.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
