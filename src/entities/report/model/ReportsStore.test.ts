import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import type { WeeklyReport } from "./types";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { ReportsStore } from "./ReportsStore";

const runMock = vi.mocked(cliRun);

const REPORT: WeeklyReport = {
  headline: "Weekly summary",
  property_id: "sc-domain:example.com",
  period: { start: "2026-11-07", end: "2026-11-13" },
};

function envelope(data: WeeklyReport): Envelope<WeeklyReport> {
  return {
    ok: true,
    data,
    meta: { artifacts: { html: "C:\\exports\\reports\\report.html" } },
    warnings: [],
  };
}

const DIFF = {
  base: {
    property_id: "sc-domain:example.com",
    period: "2026-10-31..2026-11-06",
    headline: null,
  },
  head: {
    property_id: "sc-domain:example.com",
    period: "2026-11-07..2026-11-13",
    headline: null,
  },
  comparable: true,
  headline: [],
  unknown_metrics: [],
  issues: [],
  opportunities: { added: [], resolved: [], unchanged: 0 },
  limitations_changed: { added: [], lifted: [] },
  limitations: [],
};

function diffEnvelope(): Envelope<unknown> {
  return {
    ok: true,
    data: DIFF,
    meta: {
      property_id: "sc-domain:example.com",
      base_period: "2026-10-31..2026-11-06",
      head_period: "2026-11-07..2026-11-13",
      available_periods: ["2026-11-07..2026-11-13", "2026-10-31..2026-11-06"],
    },
    warnings: ["diff warning"],
  };
}

describe("ReportsStore", () => {
  it("drops an in-flight build and its HTML artifact on reset", async () => {
    let resolve!: (value: Envelope<WeeklyReport>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );

    const store = new ReportsStore();
    const build = store.buildWeekly();
    expect(store.loading).toBe(true);

    store.reset();
    expect(store.state).toBe("idle");
    expect(store.meta).toEqual({});

    resolve(envelope(REPORT));
    expect(await build).toBe(false);
    expect(store.report).toBeNull();
    expect(store.meta).toEqual({});
    expect(store.builtAt).toBeNull();
  });

  it("keeps the previous report when a rebuild fails, with the error visible", async () => {
    runMock.mockResolvedValueOnce(envelope(REPORT));
    const store = new ReportsStore();
    expect(await store.buildWeekly()).toBe(true);

    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFIG_INVALID", message: "bad property" },
      meta: {},
      warnings: [],
    });
    expect(await store.buildWeekly()).toBe(false);
    expect(store.report).toEqual(REPORT);
    expect(store.error?.code).toBe("CONFIG_INVALID");
  });

  it("loads the diff without arguments and keeps its meta", async () => {
    runMock.mockResolvedValueOnce(diffEnvelope());
    const store = new ReportsStore();

    expect(await store.loadDiff()).toBe(true);
    expect(runMock).toHaveBeenCalledWith("report_diff");
    expect(store.diffState).toBe("ready");
    expect(store.diff?.head.period).toBe("2026-11-07..2026-11-13");
    expect(store.diffMeta.head_period).toBe("2026-11-07..2026-11-13");
    expect(store.diffWarnings).toEqual(["diff warning"]);
    expect(store.diffError).toBeNull();
  });

  it("treats fewer than two snapshots as the documented empty state", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "need two stored weekly snapshots for sc-domain:example.com; found 1",
        next_action: "run `lv24-seo report weekly` for another period",
      },
      meta: { available_periods: ["2026-11-07..2026-11-13"] },
      warnings: [],
    });
    const store = new ReportsStore();

    expect(await store.loadDiff()).toBe(false);
    expect(store.diffState).toBe("empty");
    expect(store.diffUnavailable).toBe("not_enough_snapshots");
    expect(store.diffError).toBeNull();
    expect(store.diff).toBeNull();
  });

  it("distinguishes a missing store from a real diff failure", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "CONFIG_INVALID", message: "no store configured" },
      meta: {},
      warnings: [],
    });
    const store = new ReportsStore();
    expect(await store.loadDiff()).toBe(false);
    expect(store.diffUnavailable).toBe("no_store");
    expect(store.diffState).toBe("empty");

    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "SHELL_UNAVAILABLE", message: "engine offline" },
      meta: {},
      warnings: [],
    });
    expect(await store.loadDiff()).toBe(false);
    expect(store.diffState).toBe("error");
    expect(store.diffError?.code).toBe("SHELL_UNAVAILABLE");
  });

  it("rejects a success payload without snapshot identities", async () => {
    runMock.mockResolvedValueOnce({
      ok: true,
      data: { headline: [] },
      meta: {},
      warnings: [],
    });
    const store = new ReportsStore();
    expect(await store.loadDiff()).toBe(false);
    expect(store.diffState).toBe("error");
    expect(store.diffError?.code).toBe("INVALID_ENVELOPE");
  });

  it("drops an in-flight diff and its data on reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const store = new ReportsStore();
    const load = store.loadDiff();
    expect(store.diffLoading).toBe(true);

    store.reset();
    expect(store.diffState).toBe("idle");
    expect(store.diff).toBeNull();

    resolve(diffEnvelope());
    expect(await load).toBe(false);
    expect(store.diff).toBeNull();
    expect(store.diffState).toBe("idle");
  });

  it("passes the selected window to the weekly report", async () => {
    runMock.mockResolvedValueOnce(envelope(REPORT));
    const store = new ReportsStore();
    expect(await store.buildWeekly({ days: 28, lagDays: 3 })).toBe(true);
    expect(runMock).toHaveBeenCalledWith("report_weekly", {
      args: { days: 28, lagDays: 3 },
    });
    expect(store.lastParams).toEqual({ days: 28, lagDays: 3 });
  });

  it("records engine duration, truncation and limitations for the last run", async () => {
    runMock.mockResolvedValueOnce({
      ok: true,
      data: { ...REPORT, limitations: ["no Bing rows"] },
      meta: {
        duration_ms: 5600,
        truncated: true,
        limitations: ["GSC lag"],
      },
      warnings: [],
    });
    const store = new ReportsStore({ now: () => 1000 });
    expect(await store.buildWeekly({ days: 90, lagDays: 2 })).toBe(true);

    expect(store.startedAt).toBeNull();
    expect(store.lastRun?.durationMs).toBe(5600);
    expect(store.lastRun?.durationSource).toBe("engine");
    expect(store.lastRun?.truncated).toBe(true);
    expect(store.lastRun?.limitations).toEqual(["no Bing rows", "GSC lag"]);
  });

  it("measures wall time and keeps a failed run visible", async () => {
    let clock = 2000;
    runMock.mockImplementationOnce(async () => {
      clock = 9000;
      return {
        ok: false as const,
        error: { code: "UPSTREAM_UNAVAILABLE", message: "provider timeout" },
        meta: {},
        warnings: [],
      };
    });
    const store = new ReportsStore({ now: () => clock });
    expect(await store.buildWeekly()).toBe(false);
    expect(store.lastRun?.durationMs).toBe(7000);
    expect(store.lastRun?.durationSource).toBe("measured");
    expect(store.lastRun?.ok).toBe(false);
  });

  it("clears the run summary on reset", async () => {
    runMock.mockResolvedValueOnce(envelope(REPORT));
    const store = new ReportsStore();
    expect(await store.buildWeekly()).toBe(true);
    store.reset();
    expect(store.startedAt).toBeNull();
    expect(store.lastRun).toBeNull();
    expect(store.lastParams).toBeNull();
  });
});
