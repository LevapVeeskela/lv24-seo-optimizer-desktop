import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  authDeleteCommand,
  authSetCommand,
  removeSecret,
  storeSecret,
} from "@/features/secret-set/model/SecretStore";

const invokeMock = vi.mocked(invoke);

describe("secret actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses the auth_set CliRunResult envelope", async () => {
    invokeMock.mockResolvedValue({
      command: "auth_set",
      exitCode: 0,
      envelope: {
        ok: true,
        data: { provider: "gsc", stored: true, source: "keyring" },
        meta: {},
        warnings: [],
      },
      stderr: "",
      durationMs: 1,
      truncated: false,
    });
    const result = await storeSecret("gsc", "secret-value", "C:\\w\\seo.toml");
    expect(result.ok).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("auth_set", {
      provider: "gsc",
      secret: "secret-value",
      configPath: "C:\\w\\seo.toml",
    });
  });

  it("returns the engine error instead of throwing", async () => {
    invokeMock.mockResolvedValue({
      envelope: {
        ok: false,
        error: { code: "WRITE_DISABLED", message: "env wins" },
        meta: {},
        warnings: [],
      },
    });
    const result = await removeSecret("gsc", "C:\\w\\seo.toml");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("env wins");
    expect(invokeMock).toHaveBeenCalledWith("auth_delete", {
      provider: "gsc",
      configPath: "C:\\w\\seo.toml",
    });
  });

  it("marks a missing shell command as unsupported", async () => {
    invokeMock.mockRejectedValue("Command auth_set not found");
    const result = await storeSecret("gsc", "secret-value", null);
    expect(result.ok).toBe(false);
    expect(result.unsupported).toBe(true);
    expect(result.message).toContain("auth_set");
  });

  it("keeps a normal engine failure as an error", async () => {
    invokeMock.mockRejectedValue(new Error("keyring is locked"));
    const result = await removeSecret("gsc", null);
    expect(result.ok).toBe(false);
    expect(result.unsupported).toBe(false);
    expect(result.message).toContain("keyring is locked");
  });

  it("quotes the config path in the CLI fallback commands", () => {
    expect(authSetCommand("gsc", "C:\\w\\seo.toml")).toBe(
      'lv24-seo auth set --provider gsc --stdin --config "C:\\w\\seo.toml"',
    );
    expect(authDeleteCommand("gsc", "C:\\w\\seo.toml")).toBe(
      'lv24-seo auth logout --provider gsc --json --config "C:\\w\\seo.toml"',
    );
  });
});
