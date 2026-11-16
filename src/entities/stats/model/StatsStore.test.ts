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

  it("passes the selected window to the stats command", async () => {
    runMock.mockResolvedValueOnce(envelope(DATA));
    const store = new StatsStore();
    expect(await store.refresh({ days: 28, lagDays: 3 })).toBe(true);
    expect(runMock).toHaveBeenCalledWith("stats", {
      args: { days: 28, lagDays: 3 },
    });
    expect(store.lastParams).toEqual({ days: 28, lagDays: 3 });
  });

  it("prefers meta.duration_ms and records truncation and limitations", async () => {
    runMock.mockResolvedValueOnce({
      ok: true,
      data: {
        ...DATA,
        limitations: ["gsc capped"],
        services: [
          {
            provider: "gsc",
            configured: true,
            ready: true,
            status: "ok",
            rows: 500,
            truncated: true,
          },
        ],
      },
      meta: { duration_ms: 4200, limitations: ["provider lag"] },
      warnings: [],
    });
    const store = new StatsStore({ now: () => 1000 });
    expect(await store.refresh({ days: 90, lagDays: 2 })).toBe(true);

    expect(store.startedAt).toBeNull();
    expect(store.lastRun?.durationMs).toBe(4200);
    expect(store.lastRun?.durationSource).toBe("engine");
    expect(store.lastRun?.truncated).toBe(true);
    expect(store.lastRun?.limitations).toEqual(["provider lag", "gsc capped"]);
  });

  it("falls back to measured wall time when the engine omits duration_ms", async () => {
    let clock = 1000;
    runMock.mockImplementationOnce(async () => {
      clock = 3500;
      return envelope(DATA);
    });
    const store = new StatsStore({ now: () => clock });
    expect(await store.refresh({ days: 7, lagDays: 2 })).toBe(true);
    expect(store.lastRun?.durationMs).toBe(2500);
    expect(store.lastRun?.durationSource).toBe("measured");
    expect(store.lastRun?.truncated).toBe(false);
  });

  it("drops the run summary and in-flight timer on reset", async () => {
    runMock.mockResolvedValueOnce(envelope(DATA));
    const store = new StatsStore();
    expect(await store.refresh()).toBe(true);
    expect(store.lastRun).not.toBeNull();

    store.reset();
    expect(store.startedAt).toBeNull();
    expect(store.lastRun).toBeNull();
    expect(store.lastParams).toBeNull();
  });
});
