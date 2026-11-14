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
});
