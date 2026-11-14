import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  SECRET_PROVIDER_KEYS,
  SecretStore,
  authDeleteCommand,
  authSetCommand,
  isSecretEditable,
  removeSecret,
  secretPresence,
  storeSecret,
} from "@/features/secret-set/model/SecretStore";
import { AUTH_PROVIDERS } from "@/entities/config";
import type { AuthProviderStatus } from "@/entities/config/model/types";

const invokeMock = vi.mocked(invoke);

function status(
  provider: string,
  present: boolean,
  source = present ? "keyring" : "missing",
): AuthProviderStatus {
  return {
    provider,
    secret: `${provider}_token`,
    present,
    source,
  };
}

function authStatusEnvelope(providers: AuthProviderStatus[]) {
  return {
    envelope: {
      ok: true,
      data: { providers, present: [], missing: [] },
      meta: {},
      warnings: [],
    },
  };
}

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

  it("maps every auth provider to its own label and treats omitted entries as unknown", () => {
    for (const provider of AUTH_PROVIDERS) {
      expect(SECRET_PROVIDER_KEYS[provider]).toBeTruthy();
    }
    expect(SECRET_PROVIDER_KEYS.metrika).toBe("secrets.provider.metrika");

    expect(secretPresence([], "metrika")).toBe("unknown");
    expect(secretPresence([status("yandex", true)], "metrika")).toBe("unknown");
    expect(secretPresence([status("metrika", false)], "metrika")).toBe("missing");
    expect(secretPresence([status("metrika", true)], "metrika")).toBe("present");
  });

  it("does not offer keychain actions for an environment-provided token", () => {
    expect(isSecretEditable(undefined)).toBe(true);
    expect(isSecretEditable(status("metrika", true, "keyring"))).toBe(true);
    expect(isSecretEditable(status("metrika", true, "file"))).toBe(true);
    expect(isSecretEditable(status("metrika", true, "env"))).toBe(false);
  });

  it("reports a delete that leaves an env/file token present", async () => {
    invokeMock.mockResolvedValue({
      envelope: {
        ok: true,
        data: { provider: "metrika", deleted: false, source: "file" },
        meta: {},
        warnings: [],
      },
    });
    const result = await removeSecret("metrika", "C:\\w\\seo.toml");
    expect(result.ok).toBe(true);
    expect(result.removed).toBe(false);
  });

  it("ignores a token status response that arrives after a workspace switch", async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise((resolve) => {
      resolveSecond = resolve;
    });
    invokeMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const store = new SecretStore();
    const loadFirst = store.load("C:\\a\\seo.toml");
    const loadSecond = store.load("C:\\b\\seo.toml");

    resolveSecond(authStatusEnvelope([status("metrika", true)]));
    expect(await loadSecond).toBe(true);
    expect(store.get("metrika")?.present).toBe(true);

    resolveFirst(authStatusEnvelope([status("metrika", false)]));
    expect(await loadFirst).toBe(false);
    expect(store.get("metrika")?.present).toBe(true);
  });

  it("clears the previous workspace's badges while a new status loads", async () => {
    invokeMock.mockResolvedValueOnce(
      authStatusEnvelope([status("metrika", true)]),
    );
    const store = new SecretStore();
    expect(await store.load("C:\\a\\seo.toml")).toBe(true);
    expect(store.get("metrika")?.present).toBe(true);

    let resolveNext!: (value: unknown) => void;
    invokeMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNext = resolve;
      }),
    );
    const next = store.load("C:\\b\\seo.toml");
    expect(store.state).toBe("loading");
    expect(store.entries).toEqual([]);

    resolveNext(authStatusEnvelope([status("metrika", false)]));
    expect(await next).toBe(true);
    expect(store.get("metrika")?.present).toBe(false);
  });
});
