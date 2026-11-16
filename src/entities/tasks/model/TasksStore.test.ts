import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { TasksStore } from "./TasksStore";
import { mapTask } from "./types";

const runMock = vi.mocked(cliRun);

const ROW = {
  id: 7,
  kind: "decay",
  property_id: "sc-domain:example.com",
  url: "https://example.com/a",
  rule_id: "decay-stale",
  state: "open",
  payload: { months_stale: 16 },
  created_at: "2026-11-01T10:00:00+00:00",
  updated_at: "2026-11-02T10:00:00+00:00",
};

const TASK = mapTask(ROW);

function envelope<T>(data: T, meta: Record<string, unknown> = {}): Envelope<T> {
  return { ok: true, data, meta, warnings: ["engine warning"] };
}

describe("TasksStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads a bounded, filtered list and keeps the honest meta", async () => {
    runMock.mockResolvedValueOnce(
      envelope(
        { tasks: [ROW] },
        {
          limit: 100,
          count: 1,
          total: 3,
          truncated: true,
          data_age_days: 2,
          limitations: ["task list capped at 100 of 3"],
        },
      ),
    );
    const store = new TasksStore();

    expect(
      await store.load("C:\\work\\seo.toml", {
        property: "sc-domain:example.com",
        kind: "decay",
        state: "open",
        limit: 100,
      }),
    ).toBe(true);

    expect(runMock).toHaveBeenCalledWith("tasks_list", {
      args: {
        property: "sc-domain:example.com",
        kind: "decay",
        state: "open",
        limit: 100,
      },
    });
    expect(store.state).toBe("ready");
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].ruleId).toBe("decay-stale");
    expect(store.meta?.truncated).toBe(true);
    expect(store.meta?.total).toBe(3);
    expect(store.limitations).toEqual(["task list capped at 100 of 3"]);
    expect(store.warnings).toEqual(["engine warning"]);
  });

  it("clears the rows and exposes the engine error when the list fails", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONFIG_INVALID",
        message: "tasks need the local history store",
        next_action: "run `lv24-seo init` and retry",
      },
      meta: {},
      warnings: [],
    });
    const store = new TasksStore();

    expect(await store.load("C:\\work\\seo.toml")).toBe(false);
    expect(store.state).toBe("error");
    expect(store.tasks).toEqual([]);
    expect(store.error?.code).toBe("CONFIG_INVALID");
    expect(store.error?.nextAction).toContain("init");
  });

  it("rejects an ok envelope without a task array", async () => {
    runMock.mockResolvedValueOnce(envelope({ tasks: "none" }));
    const store = new TasksStore();

    expect(await store.load("C:\\work\\seo.toml")).toBe(false);
    expect(store.error?.code).toBe("INVALID_TASKS_RESULT");
    expect(store.state).toBe("error");
  });

  it("refuses an illegal transition without calling the engine", async () => {
    const store = new TasksStore();
    const verified = { ...TASK!, state: "verified" as const };

    expect(
      await store.updateState("C:\\work\\seo.toml", verified, "in_progress"),
    ).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
    expect(store.updateError?.code).toBe("INVALID_TRANSITION");
    expect(store.lastTransition).toEqual({
      from: "verified",
      to: "in_progress",
    });
  });

  it("replaces one row after a successful update", async () => {
    runMock.mockResolvedValueOnce(
      envelope({ task: { ...ROW, state: "in_progress" } }),
    );
    const store = new TasksStore();
    store.tasks = [TASK!];

    expect(
      await store.updateState("C:\\work\\seo.toml", TASK!, "in_progress"),
    ).toBe(true);
    expect(runMock).toHaveBeenCalledWith("tasks_update", {
      args: { id: 7, state: "in_progress" },
    });
    expect(store.tasks[0].state).toBe("in_progress");
    expect(store.updatingId).toBeNull();
  });

  it("keeps the old state and shows the engine error when an update fails", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "invalid task transition open -> verified",
      },
      meta: {},
      warnings: [],
    });
    const store = new TasksStore();
    store.tasks = [TASK!];

    expect(
      await store.updateState("C:\\work\\seo.toml", TASK!, "verified"),
    ).toBe(false);
    expect(store.tasks[0].state).toBe("open");
    expect(store.updateError?.code).toBe("INVALID_INPUT");
    expect(store.updatingId).toBeNull();
  });

  it("adds a task, reports the outcome and refreshes the bounded list", async () => {
    runMock
      .mockResolvedValueOnce(envelope({ task: ROW, outcome: "created" }))
      .mockResolvedValueOnce(envelope({ tasks: [ROW] }));
    const store = new TasksStore();

    const result = await store.add("C:\\work\\seo.toml", {
      kind: "decay",
      url: "https://example.com/a",
      rule: "decay-stale",
    });

    expect(result).toEqual({ ok: true, task: TASK, outcome: "created" });
    expect(runMock).toHaveBeenNthCalledWith(1, "tasks_add", {
      args: {
        kind: "decay",
        url: "https://example.com/a",
        rule: "decay-stale",
      },
    });
    expect(runMock).toHaveBeenNthCalledWith(2, "tasks_list", {
      args: { limit: 200 },
    });
    expect(store.tasks).toHaveLength(1);
  });

  it("keeps a failed add out of the list and returns the typed error", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "INVALID_INPUT", message: "payload is not valid JSON" },
      meta: {},
      warnings: [],
    });
    const store = new TasksStore();

    const result = await store.add("C:\\work\\seo.toml", {
      kind: "decay",
      url: "https://example.com/a",
      rule: "decay-stale",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
    }
    expect(store.addError?.code).toBe("INVALID_INPUT");
    expect(store.addState).toBe("idle");
    expect(runMock).toHaveBeenCalledTimes(1);
  });
});
