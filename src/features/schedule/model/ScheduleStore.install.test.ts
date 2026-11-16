import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { ScheduleStore } from "./ScheduleStore";

const runMock = vi.mocked(cliRun);

const INSTALLED = {
  target: "windows",
  dry_run: false,
  installed: true,
  command: "schtasks /Create /XML C:\\tasks\\lv24-seo-weekly.xml /TN lv24-seo-weekly /F",
  files: { "lv24-seo-weekly.xml": "<Task />" },
  paths: { "lv24-seo-weekly.xml": "C:\\tasks\\lv24-seo-weekly.xml" },
  warnings: ["the task runs as the signed-in user"],
};

function success(data: unknown, warnings: string[] = []): Envelope<unknown> {
  return { ok: true, data, meta: { kind: "weekly" }, warnings };
}

describe("ScheduleStore install", () => {
  it("opens the confirmation without calling the engine", () => {
    const store = new ScheduleStore();
    expect(store.requestInstall()).toBe(true);
    expect(store.installPending).toBe(true);
    expect(store.installState).toBe("idle");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("refuses to install without the confirmation", async () => {
    const store = new ScheduleStore();
    expect(await store.confirmInstall("C:\\ws\\seo.toml")).toBe(false);
    expect(store.installError?.code).toBe("SCHEDULE_NOT_CONFIRMED");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("installs the selected kind with the engine default cron", async () => {
    runMock.mockResolvedValueOnce(success(INSTALLED));
    const store = new ScheduleStore();
    store.setInstallKind("daily");

    expect(store.requestInstall()).toBe(true);
    expect(await store.confirmInstall("C:\\ws\\seo.toml")).toBe(true);

    expect(runMock).toHaveBeenCalledWith("schedule_install", {
      args: { kind: "daily", allowWrite: true },
      configPath: "C:\\ws\\seo.toml",
    });
    expect(store.installState).toBe("installed");
    expect(store.installResult?.installed).toBe(true);
    expect(store.installResult?.paths).toEqual([
      { name: "lv24-seo-weekly.xml", content: "C:\\tasks\\lv24-seo-weekly.xml" },
    ]);
    expect(store.installWarnings).toEqual([
      "the task runs as the signed-in user",
    ]);
  });

  it("sends a custom cron only when it is set", async () => {
    runMock.mockResolvedValue(success(INSTALLED));
    const store = new ScheduleStore();
    store.setInstallCron("  0   7 * * 1  ");
    store.requestInstall();

    expect(await store.confirmInstall("C:\\ws\\seo.toml")).toBe(true);
    expect(runMock).toHaveBeenLastCalledWith("schedule_install", {
      args: { kind: "weekly", cron: "0 7 * * 1", allowWrite: true },
      configPath: "C:\\ws\\seo.toml",
    });
  });

  it("refuses an invalid cron without an engine call", () => {
    const store = new ScheduleStore();
    store.setInstallCron("0 7 * *");

    expect(store.installCronValidation.valid).toBe(false);
    expect(store.requestInstall()).toBe(false);
    expect(store.installPending).toBe(false);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("surfaces an engine failure and keeps the error code", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "cron is not supported by the Windows scheduler",
        next_action: "use a weekly or daily schedule",
        retryable: false,
      },
      meta: {},
      warnings: ["config loaded"],
    });
    const store = new ScheduleStore();
    store.requestInstall();

    expect(await store.confirmInstall("C:\\ws\\seo.toml")).toBe(false);
    expect(store.installState).toBe("error");
    expect(store.installResult).toBeNull();
    expect(store.installError).toMatchObject({
      code: "INVALID_INPUT",
      message: "cron is not supported by the Windows scheduler",
      nextAction: "use a weekly or daily schedule",
    });
    expect(store.installWarnings).toEqual(["config loaded"]);
  });

  it("explains a non-JSON response from an engine without schedule install", async () => {
    runMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "CLI_INVALID_JSON", message: "cli_run returned no JSON" },
      meta: {},
      warnings: [],
    });
    const store = new ScheduleStore();
    store.requestInstall();

    expect(await store.confirmInstall("C:\\ws\\seo.toml")).toBe(false);
    expect(store.installError?.nextAction).toContain("update it");
  });

  it("cancels a pending confirmation and drops it on reset", async () => {
    const store = new ScheduleStore();
    store.requestInstall();
    store.cancelInstall();
    expect(store.installPending).toBe(false);

    store.requestInstall();
    store.reset();
    expect(store.installPending).toBe(false);
    expect(store.installState).toBe("idle");
    expect(store.installResult).toBeNull();
  });

  it("ignores an in-flight install after a reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    runMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const store = new ScheduleStore();
    store.requestInstall();
    const install = store.confirmInstall("C:\\ws\\seo.toml");
    expect(store.installing).toBe(true);

    store.reset();
    expect(store.installState).toBe("idle");

    resolve(success(INSTALLED));
    expect(await install).toBe(false);
    expect(store.installResult).toBeNull();
  });

  it("drops a previous result when the install form changes", async () => {
    runMock.mockResolvedValueOnce(success(INSTALLED));
    const store = new ScheduleStore();
    store.requestInstall();
    await store.confirmInstall("C:\\ws\\seo.toml");
    expect(store.installResult).not.toBeNull();

    store.setInstallKind("daily");
    expect(store.installState).toBe("idle");
    expect(store.installResult).toBeNull();
  });
});
