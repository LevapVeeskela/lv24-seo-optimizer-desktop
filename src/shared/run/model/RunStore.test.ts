import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { RunStore } from "./RunStore";

function success(): Envelope<unknown> {
  return { ok: true, data: {}, meta: {}, warnings: [] };
}

function failure(code = "CLI_FAILED"): Envelope<unknown> {
  return {
    ok: false,
    error: { code, message: "engine failed", retryable: false },
    meta: {},
    warnings: [],
  };
}

function makeStore(cancel = vi.fn(async () => true)): {
  store: RunStore;
  cancel: ReturnType<typeof vi.fn>;
} {
  let nextId = 0;
  let tick = 1_000;
  return {
    store: new RunStore({
      cancel,
      newId: () => `run-${++nextId}`,
      now: () => (tick += 1_000),
    }),
    cancel,
  };
}

describe("RunStore", () => {
  it("registers a run before the call and exposes it to the banner", () => {
    const { store } = makeStore();
    const entry = store.start("crawl");

    expect(entry.status).toBe("running");
    expect(entry.id).toBe("run-1");
    expect(store.activeCount).toBe(1);
    expect(store.activeFor("crawl")).toBe(entry);
    expect(store.bannerEntries).toEqual([entry]);
  });

  it("keeps an active run when the page that started it is gone", () => {
    const { store } = makeStore();
    const entry = store.start("reportWeekly");

    // A route change unmounts the page but never touches the root run store.
    // Re-reading it is what a later visit to the page does.
    expect(store.find(entry.id)).toBe(entry);
    expect(store.activeFor("reportWeekly")?.status).toBe("running");

    store.settle(entry, failure("RUN_CANCELLED"));
    expect(entry.status).toBe("cancelled");
    expect(store.activeCount).toBe(0);
    expect(store.bannerEntries).toEqual([entry]);
  });

  it("maps a completed envelope to succeeded and a typed error to failed", () => {
    const { store } = makeStore();
    const okEntry = store.start("logsAnalyze");
    expect(store.settle(okEntry, success())).toBe("succeeded");
    expect(okEntry.finishedAt).not.toBeNull();
    expect(okEntry.durationMs).toBeGreaterThan(0);

    const failedEntry = store.start("backupCreate");
    expect(store.settle(failedEntry, failure("BACKUP_FAILED"))).toBe("failed");
    expect(failedEntry.errorCode).toBe("BACKUP_FAILED");
  });

  it("cancels one run and shows the distinct cancelled state", async () => {
    const cancel = vi.fn(async () => true);
    const { store } = makeStore(cancel);
    const entry = store.start("crawl");

    await expect(store.cancel(entry.id)).resolves.toBe(true);
    expect(entry.status).toBe("cancelling");
    expect(entry.cancelRequested).toBe(true);

    store.settle(entry, failure("RUN_CANCELLED"));
    expect(entry.status).toBe("cancelled");
    expect(entry.errorCode).toBe("RUN_CANCELLED");
    expect(cancel).toHaveBeenCalledWith(entry.id);
  });

  it("refuses a second cancel and a cancel for a finished run", async () => {
    const cancel = vi.fn(async () => true);
    const { store } = makeStore(cancel);
    const entry = store.start("crawl");

    await store.cancel(entry.id);
    await expect(store.cancel(entry.id)).resolves.toBe(false);
    expect(cancel).toHaveBeenCalledTimes(1);

    const finished = store.start("logsAnalyze");
    store.settle(finished, success());
    await expect(store.cancel(finished.id)).resolves.toBe(false);
    expect(finished.status).toBe("succeeded");
  });

  it("reverts to running when the shell refuses the cancel", async () => {
    const cancel = vi.fn(async () => false);
    const { store } = makeStore(cancel);
    const entry = store.start("crawl");

    await expect(store.cancel(entry.id)).resolves.toBe(false);
    expect(entry.status).toBe("running");
    expect(entry.cancelRequested).toBe(false);
  });

  it("keeps the cancelled banner until it is dismissed", () => {
    const { store } = makeStore();
    const entry = store.start("crawl");
    store.settle(entry, failure("RUN_CANCELLED"));

    expect(store.bannerEntries).toHaveLength(1);
    store.dismiss(entry.id);
    expect(entry.dismissed).toBe(true);
    expect(store.bannerEntries).toHaveLength(0);
  });

  it("does not show succeeded or failed runs in the global banner", () => {
    const { store } = makeStore();
    const okEntry = store.start("crawl");
    store.settle(okEntry, success());
    expect(store.bannerEntries).toHaveLength(0);

    const failed = store.start("logsAnalyze");
    store.settle(failed, failure());
    expect(store.bannerEntries).toHaveLength(0);
  });

  it("shows every active run and bounds the finished history", () => {
    const { store } = makeStore();
    const first = store.start("crawl");
    const second = store.start("logsAnalyze");
    expect(store.bannerEntries.map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ]);

    store.settle(first, success());
    store.settle(second, success());
    for (let index = 0; index < 30; index += 1) {
      store.settle(store.start("crawl"), success());
    }
    expect(store.entries.length).toBeLessThanOrEqual(20);
  });
});
