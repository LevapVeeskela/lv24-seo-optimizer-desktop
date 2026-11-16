import { describe, expect, it } from "vitest";
import {
  TASK_STATES,
  canTransition,
  filterTasks,
  mapTask,
  mapTaskList,
  mapTaskListMeta,
  nextTaskStates,
  normalizeTaskQuery,
  type TaskRow,
} from "./types";

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

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 1,
    kind: "decay",
    propertyId: "sc-domain:example.com",
    url: "https://example.com/a",
    ruleId: "decay-stale",
    state: "open",
    payload: {},
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("task mapping", () => {
  it("maps the engine row without renaming evidence", () => {
    expect(mapTask(ROW)).toEqual({
      id: 7,
      kind: "decay",
      propertyId: "sc-domain:example.com",
      url: "https://example.com/a",
      ruleId: "decay-stale",
      state: "open",
      payload: { months_stale: 16 },
      createdAt: "2026-11-01T10:00:00+00:00",
      updatedAt: "2026-11-02T10:00:00+00:00",
    });
  });

  it("skips a row with an unknown state or a non-numeric id", () => {
    expect(mapTask({ ...ROW, state: "closed" })).toBeNull();
    expect(mapTask({ ...ROW, id: "7" })).toBeNull();
    expect(mapTask({ ...ROW, rule_id: "  " })).toBeNull();
  });

  it("reports malformed rows instead of silently dropping them", () => {
    expect(
      mapTaskList({ tasks: [ROW, { ...ROW, id: 8, state: "closed" }] }),
    ).toEqual({ tasks: [mapTask(ROW)], skipped: 1 });
    expect(mapTaskList({ tasks: "none" })).toBeNull();
    expect(mapTaskList(null)).toBeNull();
  });

  it("keeps bounded meta and treats count below total as truncated", () => {
    expect(
      mapTaskListMeta(
        {
          limit: 100,
          count: 1,
          total: 3,
          data_age_days: 2,
          limitations: ["capped"],
        },
        1,
      ),
    ).toEqual({
      limit: 100,
      count: 1,
      total: 3,
      truncated: true,
      dataAgeDays: 2,
      propertyId: null,
      kind: null,
      state: null,
      limitations: ["capped"],
    });
  });
});

describe("task filters and transitions", () => {
  const rows = [
    task({ id: 1 }),
    task({ id: 2, kind: "finding", state: "verified" }),
    task({ id: 3, propertyId: "sc-domain:other.test", state: "dismissed" }),
  ];

  it("filters by property, kind and state", () => {
    expect(filterTasks(rows, { property: "sc-domain:other.test" })).toEqual([
      rows[2],
    ]);
    expect(filterTasks(rows, { kind: "finding" })).toEqual([rows[1]]);
    expect(filterTasks(rows, { state: "open" })).toEqual([rows[0]]);
    expect(
      filterTasks(rows, {
        property: "sc-domain:example.com",
        kind: "decay",
        state: "open",
      }),
    ).toEqual([rows[0]]);
    expect(filterTasks(rows, { state: "all" })).toEqual(rows);
  });

  it("normalizes query defaults and the shell's 500-row bound", () => {
    expect(normalizeTaskQuery()).toEqual({ limit: 200 });
    expect(
      normalizeTaskQuery({
        property: "  sc-domain:example.com ",
        kind: " decay ",
        state: "open",
        limit: 900,
      }),
    ).toEqual({
      property: "sc-domain:example.com",
      kind: "decay",
      state: "open",
      limit: 500,
    });
    expect(normalizeTaskQuery({ state: "all", limit: 0 })).toEqual({ limit: 1 });
  });

  it("offers only legal next states and accepts the engine's same-state no-op", () => {
    expect(TASK_STATES).toEqual([
      "open",
      "in_progress",
      "verified",
      "dismissed",
    ]);
    expect(nextTaskStates("open")).toEqual([
      "in_progress",
      "verified",
      "dismissed",
    ]);
    expect(nextTaskStates("verified")).toEqual(["open", "dismissed"]);
    expect(canTransition("verified", "in_progress")).toBe(false);
    expect(canTransition("dismissed", "in_progress")).toBe(true);
    expect(canTransition("open", "open")).toBe(true);
  });
});
