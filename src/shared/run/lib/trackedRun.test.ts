import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { RunStore } from "../model/RunStore";
import { trackRun } from "./trackedRun";

function makeStore(): RunStore {
  let nextId = 0;
  return new RunStore({
    cancel: async () => true,
    newId: () => `run-${++nextId}`,
  });
}

describe("trackRun", () => {
  it("passes the run id to the call and settles a success", async () => {
    const store = makeStore();
    const run = vi.fn(async (): Promise<Envelope<unknown>> => ({
      ok: true,
      data: {},
      meta: {},
      warnings: [],
    }));

    const envelope = await trackRun(store, { kind: "crawl", run });

    expect(envelope.ok).toBe(true);
    expect(run).toHaveBeenCalledWith("run-1");
    expect(store.entries[0].status).toBe("succeeded");
    expect(store.entries[0].command).toBe("crawl");
  });

  it("settles a thrown transport error instead of leaving the banner running", async () => {
    const store = makeStore();
    const envelope = await trackRun(store, {
      kind: "logsAnalyze",
      run: async () => {
        throw new Error("IPC closed");
      },
    });

    expect(envelope.ok).toBe(false);
    if (!envelope.ok) {
      expect(envelope.error.code).toBe("RUN_FAILED");
      expect(envelope.error.message).toContain("IPC closed");
    }
    expect(store.entries[0].status).toBe("failed");
  });

  it("uses the cancellable command for every kind", async () => {
    const store = makeStore();
    await trackRun(store, {
      kind: "backupRestore",
      run: async () => ({ ok: true, data: {}, meta: {}, warnings: [] }),
    });
    expect(store.entries[0].command).toBe("backup_restore");
  });
});
