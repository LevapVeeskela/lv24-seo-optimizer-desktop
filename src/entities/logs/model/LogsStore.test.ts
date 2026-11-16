import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { LogsStore } from "./LogsStore";

const PAYLOAD = {
  total_lines: 4,
  parsed_lines: 3,
  skipped_lines: 1,
  bot_daily: [
    {
      date: "2026-11-15",
      bot: "googlebot",
      status: "2xx",
      hits: 3,
      bytes: 900,
      p95_ms: 4,
    },
  ],
  crawl_waste: {
    hits: 1,
    bytes: 100,
    share: 0.25,
    total_hits: 4,
    total_bytes: 1000,
    by_bot: [],
  },
};

function success(data: unknown = PAYLOAD): Envelope<unknown> {
  return {
    ok: true,
    data,
    meta: {
      file: "C:\\logs\\access.log",
      truncated: false,
      limitations: ["bot classification is user-agent based"],
    },
    warnings: ["skipped 1 of 4 lines"],
  };
}

function store(analyze: ReturnType<typeof vi.fn>) {
  return new LogsStore(
    analyze as unknown as typeof import("../lib/ipc").runLogsAnalyze,
    () => new Date("2026-11-16T10:00:00Z"),
  );
}

describe("LogsStore", () => {
  it("sends the picked file and bot filter to logs_analyze and maps the result", async () => {
    const analyze = vi.fn(async () => success());
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");
    logs.setBot("googlebot");

    expect(await logs.run()).toBe(true);

    expect(analyze).toHaveBeenCalledWith({
      file: "C:\\logs\\access.log",
      bot: "googlebot",
    });
    expect(logs.state).toBe("ready");
    expect(logs.result?.bot_daily).toHaveLength(1);
    expect(logs.result?.crawl_waste.share).toBe(0.25);
    expect(logs.meta.truncated).toBe(false);
    expect(logs.warnings).toEqual(["skipped 1 of 4 lines"]);
    expect(logs.lastRunAt).toBe("2026-11-16T10:00:00.000Z");
    expect(logs.raw).toEqual(PAYLOAD);
  });

  it("omits the bot argument when no filter is selected", async () => {
    const analyze = vi.fn(async () => success());
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");

    await logs.run();

    expect(analyze).toHaveBeenCalledWith({ file: "C:\\logs\\access.log" });
  });

  it("refuses to run without a file", async () => {
    const analyze = vi.fn(async () => success());
    const logs = store(analyze);

    expect(await logs.run()).toBe(false);
    expect(analyze).not.toHaveBeenCalled();
    expect(logs.error?.code).toBe("LOG_FILE_MISSING");
    expect(logs.state).toBe("error");
  });

  it("rejects an ok envelope without a data object", async () => {
    const analyze = vi.fn(async () => ({
      ok: true,
      data: null,
      meta: {},
      warnings: [],
    }));
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");

    expect(await logs.run()).toBe(false);
    expect(logs.error?.code).toBe("INVALID_LOGS_RESULT");
    expect(logs.result).toBeNull();
  });

  it("keeps the previous analysis visible when a rerun fails", async () => {
    const analyze = vi
      .fn()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INVALID_INPUT", message: "unknown bot 'ahrefs'" },
        meta: {},
        warnings: [],
      });
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");
    expect(await logs.run()).toBe(true);

    expect(await logs.run()).toBe(false);
    expect(logs.state).toBe("error");
    expect(logs.error?.code).toBe("INVALID_INPUT");
    expect(logs.result?.bot_daily).toHaveLength(1);
  });

  it("clears the analysis when another file is picked", async () => {
    const analyze = vi.fn(async () => success());
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");
    await logs.run();

    logs.setFile("C:\\logs\\other.log");

    expect(logs.state).toBe("idle");
    expect(logs.result).toBeNull();
    expect(logs.lastRunAt).toBeNull();
  });

  it("ignores an in-flight run after reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    const analyze = vi.fn(
      () =>
        new Promise<Envelope<unknown>>((done) => {
          resolve = done;
        }),
    );
    const logs = store(analyze);
    logs.setFile("C:\\logs\\access.log");
    const run = logs.run();
    expect(logs.loading).toBe(true);

    logs.reset();
    expect(logs.state).toBe("idle");
    expect(logs.file).toBeNull();

    resolve(success());
    expect(await run).toBe(false);
    expect(logs.result).toBeNull();
  });
});
