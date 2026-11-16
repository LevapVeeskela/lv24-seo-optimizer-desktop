import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { DEFAULT_CRON, ScheduleStore } from "./ScheduleStore";

const runMock = vi.mocked(cliRun);

const ARTIFACT = {
  target: "cron",
  dry_run: true,
  command: "crontab -",
  files: {
    "lv24-seo-weekly.cron":
      "# lv24-seo weekly SEO report\n0 6 * * 1 lv24-seo report weekly --json\n",
  },
  warnings: ["cron runs in host time"],
};

function success(data: unknown, warnings: string[] = []): Envelope<unknown> {
  return { ok: true, data, meta: { target: "cron" }, warnings };
}

describe("ScheduleStore", () => {
  it("sends the cron expression, resolved target and workspace config", async () => {
    runMock.mockResolvedValueOnce(success(ARTIFACT, ["engine note"]));
    const store = new ScheduleStore();
    store.setTarget("cron");

    await expect(store.generate("C:\\ws\\seo.toml", "linux")).resolves.toBe(
      true,
    );

    expect(runMock).toHaveBeenCalledWith("schedule_print", {
      args: { cron: DEFAULT_CRON, target: "cron" },
      configPath: "C:\\ws\\seo.toml",
    });
    expect(store.state).toBe("ready");
    expect(store.artifact?.files).toEqual([
      {
        name: "lv24-seo-weekly.cron",
        content:
          "# lv24-seo weekly SEO report\n0 6 * * 1 lv24-seo report weekly --json\n",
      },
    ]);
    expect(store.warnings).toEqual(["engine note", "cron runs in host time"]);
    expect(store.error).toBeNull();
  });

  it("follows the host platform until the user picks a target", async () => {
    runMock.mockResolvedValue(success(ARTIFACT));
    const store = new ScheduleStore();

    await store.generate(null, "linux");
    expect(runMock).toHaveBeenLastCalledWith("schedule_print", {
      args: { cron: DEFAULT_CRON, target: "systemd" },
    });

    store.setTarget("windows");
    expect(store.resolveTarget("linux")).toBe("windows");
    await store.generate(null, "linux");
    expect(runMock).toHaveBeenLastCalledWith("schedule_print", {
      args: { cron: DEFAULT_CRON, target: "windows" },
    });
  });

  it("refuses an invalid cron without an engine call", async () => {
    const store = new ScheduleStore();
    store.setCron("0 6 * *");

    await expect(store.generate("C:\\ws\\seo.toml", "windows")).resolves.toBe(
      false,
    );
    expect(runMock).not.toHaveBeenCalled();
    expect(store.state).toBe("idle");
    expect(store.validation).toEqual({
      valid: false,
      issue: { kind: "fields", count: 4 },
    });
  });

  it("surfaces the error envelope and keeps the artifact empty", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "unknown or unavailable timezone: 'Mars/Base'",
        next_action: "choose an installed IANA timezone",
        retryable: false,
      },
      meta: {},
      warnings: ["config loaded"],
    });
    const store = new ScheduleStore();

    await expect(store.generate("C:\\ws\\seo.toml", "cron")).resolves.toBe(
      false,
    );

    expect(store.state).toBe("error");
    expect(store.artifact).toBeNull();
    expect(store.error).toMatchObject({
      code: "INVALID_INPUT",
      message: "unknown or unavailable timezone: 'Mars/Base'",
      nextAction: "choose an installed IANA timezone",
    });
    expect(store.warnings).toEqual(["config loaded"]);
  });

  it("hides a previous artifact as soon as the form changes", async () => {
    runMock.mockResolvedValueOnce(success(ARTIFACT));
    const store = new ScheduleStore();
    await store.generate("C:\\ws\\seo.toml", "cron");
    expect(store.artifact).not.toBeNull();

    store.setCron("0 7 * * 1");
    expect(store.state).toBe("idle");
    expect(store.artifact).toBeNull();
    expect(store.warnings).toEqual([]);
  });

  it("drops an in-flight render when the workspace changes", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const store = new ScheduleStore();
    const render = store.generate("C:\\old\\seo.toml", "cron");
    expect(store.loading).toBe(true);

    store.reset();
    expect(store.state).toBe("idle");

    resolve(success(ARTIFACT));
    await expect(render).resolves.toBe(false);
    expect(store.artifact).toBeNull();
    expect(store.state).toBe("idle");
  });

  it("keeps a ready state with no files when the engine omits them", async () => {
    runMock.mockResolvedValueOnce(success({ dry_run: true }));
    const store = new ScheduleStore();

    await expect(store.generate(null, "cron")).resolves.toBe(true);
    expect(store.state).toBe("ready");
    expect(store.artifact).toEqual({
      target: null,
      dryRun: true,
      command: null,
      files: [],
      warnings: [],
    });
  });
});
