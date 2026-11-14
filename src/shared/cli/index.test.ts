import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { cliRun } from "./index";

const invokeMock = vi.mocked(invoke);

const envelope = {
  ok: true,
  data: { value: 1 },
  meta: { version: "0.5.0" },
  warnings: [],
};

describe("cliRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps the shell CliRunResult envelope", async () => {
    invokeMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
      envelope,
    });

    await expect(cliRun("stats")).resolves.toEqual(envelope);
    expect(invokeMock).toHaveBeenCalledWith("cli_run", { command: "stats" });
  });

  it("accepts a direct envelope from an older shell", async () => {
    invokeMock.mockResolvedValue(envelope);
    await expect(cliRun("stats")).resolves.toEqual(envelope);
  });

  it("turns an IPC failure into a typed envelope", async () => {
    invokeMock.mockRejectedValue(new Error("shell gone"));
    const result = await cliRun("stats");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SHELL_UNAVAILABLE");
      expect(result.error.message).toContain("shell gone");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("preserves the shell's typed code and message", async () => {
    invokeMock.mockRejectedValue({
      code: "CONFIG_READ",
      message: "config path is outside approved roots",
      next_action: "Choose seo.toml from the workspace.",
    });
    const result = await cliRun("stats");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFIG_READ");
      expect(result.error.message).toBe(
        "config path is outside approved roots",
      );
      expect(result.error.next_action).toBe(
        "Choose seo.toml from the workspace.",
      );
      expect(result.error.retryable).toBe(false);
    }
  });

  it("marks only a transport failure as retryable", async () => {
    invokeMock.mockRejectedValue({
      code: "SHELL_UNAVAILABLE",
      message: "shell gone",
    });
    const result = await cliRun("stats");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SHELL_UNAVAILABLE");
      expect(result.error.retryable).toBe(true);
    }
  });
});
