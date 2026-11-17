import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  runIndexingHistory,
  runIndexingStatus,
  runScheduleStatus,
} from "./ipc";

const invokeMock = vi.mocked(invoke);
const CONFIG = "C:\\ws\\seo.toml";

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockResolvedValue({
    ok: true,
    data: {},
    meta: {},
    warnings: [],
  });
});

function lastPayload(): Record<string, unknown> {
  const call = invokeMock.mock.calls.at(-1);
  expect(call?.[0]).toBe("cli_run");
  return call?.[1] as Record<string, unknown>;
}

describe("indexing automation IPC argument mapping", () => {
  it("maps indexing status to provider/limit/live without a write gate", async () => {
    await runIndexingStatus(
      { provider: "all", limit: 50, live: true },
      CONFIG,
    );
    const payload = lastPayload();
    expect(payload).toEqual({
      command: "indexing_status",
      args: { provider: "all", limit: 50, live: true },
      configPath: CONFIG,
    });
    expect(payload.args).not.toHaveProperty("allowWrite");
    expect(payload.args).not.toHaveProperty("confirm");
  });

  it("maps a narrower indexing status read", async () => {
    await runIndexingStatus({ provider: "gsc" }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "indexing_status",
      args: { provider: "gsc" },
      configPath: CONFIG,
    });
  });

  it("maps the history limit and omits an empty one", async () => {
    await runIndexingHistory(30, CONFIG);
    expect(lastPayload()).toEqual({
      command: "indexing_history",
      args: { limit: 30 },
      configPath: CONFIG,
    });

    await runIndexingHistory(undefined, CONFIG);
    expect(lastPayload()).toEqual({
      command: "indexing_history",
      configPath: CONFIG,
    });
  });
  it("maps schedule status for the indexing job and host target", async () => {
    await runScheduleStatus(
      { kind: "indexing", target: "windows" },
      CONFIG,
    );
    expect(lastPayload()).toEqual({
      command: "schedule_status",
      args: { kind: "indexing", target: "windows" },
      configPath: CONFIG,
    });

    await runScheduleStatus({ kind: "indexing" }, CONFIG);
    expect(lastPayload()).toEqual({
      command: "schedule_status",
      args: { kind: "indexing" },
      configPath: CONFIG,
    });
  });
});
