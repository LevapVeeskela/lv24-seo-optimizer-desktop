import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { runAuthStatus, runDoctor } from "@/entities/config/api/configApi";

const invokeMock = vi.mocked(invoke);

describe("config CLI bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps auth_status from the cli_run result", async () => {
    invokeMock.mockResolvedValue({
      command: "auth_status",
      exitCode: 0,
      envelope: {
        ok: true,
        data: {
          providers: [
            { provider: "gsc", secret: "gsc_token", present: true, source: "keyring" },
          ],
          present: ["gsc"],
          missing: [],
        },
        meta: {},
        warnings: [],
      },
      stderr: "",
      durationMs: 1,
      truncated: false,
    });
    const result = await runAuthStatus("C:\\w\\seo.toml");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.providers[0].source).toBe("keyring");
    }
    expect(invokeMock).toHaveBeenCalledWith("cli_run", {
      command: "auth_status",
      configPath: "C:\\w\\seo.toml",
    });
  });

  it("reads doctor checks from meta when the engine reports a failure", async () => {
    invokeMock.mockResolvedValue({
      envelope: {
        ok: false,
        error: { code: "INTERNAL", message: "environment check failed" },
        meta: {
          healthy: false,
          checks: [
            { id: "python", ok: true, detail: "3.12" },
            { id: "data_dir", ok: false, detail: "missing" },
          ],
        },
        warnings: [],
      },
    });
    const result = await runDoctor("C:\\w\\seo.toml");
    expect(result.ok).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.message).toContain("environment check failed");
  });

  it("turns an IPC failure into a doctor result instead of throwing", async () => {
    invokeMock.mockRejectedValue(new Error("shell down"));
    const result = await runDoctor(null);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("shell down");
  });
});
