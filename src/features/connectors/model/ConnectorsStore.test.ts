import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  OAUTH_LOGIN_PROVIDERS: ["gsc", "yandex", "metrika"],
  OAUTH_STATUS_PROVIDER: {
    gsc: "gsc_oauth",
    yandex: "yandex_oauth",
    metrika: "metrika_oauth",
  },
  loadAuthStatus: vi.fn(),
  openOAuthUrl: vi.fn(),
  runAuthLogin: vi.fn(),
}));

import type { Envelope } from "@/shared/cli";
import type { AuthStatusData } from "@/entities/config";
import {
  loadAuthStatus,
  openOAuthUrl,
  runAuthLogin,
  type AuthLoginData,
} from "../lib/ipc";
import { ConnectorsStore } from "./ConnectorsStore";

const CONFIG = "C:\\ws\\seo.toml";
const YANDEX_URL =
  "https://oauth.yandex.ru/authorize?response_type=code&client_id=abc&state=xyz";

function ok<T>(data: T): Envelope<T> {
  return { ok: true, data, meta: {}, warnings: [] };
}

function failure(
  code: string,
  message: string,
  nextAction?: string,
): Envelope<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(nextAction ? { next_action: nextAction } : {}),
      retryable: false,
    },
    meta: {},
    warnings: [],
  };
}

function status(
  entries: Array<{ provider: string; present: boolean }>,
): Envelope<AuthStatusData> {
  const providers = entries.map((entry) => ({
    provider: entry.provider,
    secret: "",
    present: entry.present,
    source: entry.present ? "keyring" : "missing",
    expires_at: null,
  }));
  return ok({
    providers,
    present: entries.filter((entry) => entry.present).map((entry) => entry.provider),
    missing: entries.filter((entry) => !entry.present).map((entry) => entry.provider),
  });
}

describe("ConnectorsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAuthStatus).mockResolvedValue(status([]));
    vi.mocked(openOAuthUrl).mockResolvedValue("opened");
    vi.mocked(runAuthLogin).mockResolvedValue(ok({ provider: "gsc" }));
  });

  it("reports connected, not connected and unknown from auth status", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      status([
        { provider: "gsc_oauth", present: true },
        { provider: "yandex_oauth", present: false },
      ]),
    );
    const store = new ConnectorsStore();
    await expect(store.load(CONFIG)).resolves.toBe(true);

    expect(store.statusState).toBe("ready");
    expect(store.presence("gsc")).toBe("connected");
    expect(store.presence("yandex")).toBe("not_connected");
    // A missing entry is unknown, not "not connected".
    expect(store.presence("metrika")).toBe("unknown");
    expect(loadAuthStatus).toHaveBeenCalledWith(CONFIG);
  });

  it("connects Google with provider only and refreshes the status", async () => {
    vi.mocked(runAuthLogin).mockResolvedValue(
      ok({
        provider: "gsc",
        flow: "oauth",
        scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
        expires_at: "2026-11-18T12:00:00+00:00",
        target: "sc-domain:example.com",
      }),
    );
    vi.mocked(loadAuthStatus).mockResolvedValue(
      status([{ provider: "gsc_oauth", present: true }]),
    );
    const store = new ConnectorsStore();

    await expect(store.connect("gsc", CONFIG)).resolves.toBe(true);

    expect(runAuthLogin).toHaveBeenCalledWith({ provider: "gsc" }, CONFIG);
    expect(store.phase).toBe("connected");
    expect(store.presence("gsc")).toBe("connected");
    expect(loadAuthStatus).toHaveBeenCalledWith(CONFIG);
  });

  it("keeps the engine next_action when Google setup is missing", async () => {
    vi.mocked(runAuthLogin).mockResolvedValue(
      failure(
        "AUTH_REQUIRED",
        "Google OAuth client_id is not configured",
        "lv24-seo auth set --provider gsc_oauth_secret --stdin",
      ),
    );
    const store = new ConnectorsStore();

    await expect(store.connect("gsc", CONFIG)).resolves.toBe(false);

    expect(store.phase).toBe("error");
    expect(store.error?.code).toBe("AUTH_REQUIRED");
    expect(store.error?.nextAction).toContain("gsc_oauth_secret");
    expect(store.busy).toBe(false);
  });

  it("treats a manual login envelope as missing OAuth setup", async () => {
    vi.mocked(runAuthLogin).mockResolvedValue(
      ok({
        provider: "gsc",
        flow: "manual",
        target: "sc-domain:example.com",
        next: "lv24-seo auth set --provider gsc --stdin",
        steps: ["Create an OAuth client"],
      }),
    );
    const store = new ConnectorsStore();

    await expect(store.connect("gsc", CONFIG)).resolves.toBe(false);

    expect(store.phase).toBe("error");
    expect(store.error?.code).toBe("AUTH_REQUIRED");
    expect(store.error?.nextAction).toContain("auth set");
    expect(store.presence("gsc")).toBe("unknown");
  });

  it("runs Yandex in two steps and clears the code after use", async () => {
    vi.mocked(runAuthLogin)
      .mockResolvedValueOnce(
        ok({
          provider: "yandex",
          flow: "oauth",
          authorization_url: YANDEX_URL,
          target: "example.com",
        }),
      )
      .mockResolvedValueOnce(ok({ provider: "yandex", flow: "oauth" }));
    vi.mocked(loadAuthStatus).mockResolvedValue(
      status([{ provider: "yandex_oauth", present: true }]),
    );
    const store = new ConnectorsStore();

    await expect(store.connect("yandex", CONFIG)).resolves.toBe(true);
    expect(runAuthLogin).toHaveBeenNthCalledWith(
      1,
      { provider: "yandex", urlOnly: true },
      CONFIG,
    );
    expect(store.phase).toBe("awaiting-code");
    expect(store.authorizationUrl).toBe(YANDEX_URL);
    expect(store.code).toBe("");

    store.setCode("  abc123  ");
    await expect(store.finish(CONFIG)).resolves.toBe(true);

    expect(runAuthLogin).toHaveBeenNthCalledWith(
      2,
      { provider: "yandex", code: "abc123" },
      CONFIG,
    );
    expect(store.code).toBe("");
    expect(store.authorizationUrl).toBe("");
    expect(store.phase).toBe("connected");
    expect(store.presence("yandex")).toBe("connected");
  });

  it("clears a rejected code but keeps the consent URL", async () => {
    vi.mocked(runAuthLogin)
      .mockResolvedValueOnce(
        ok({ provider: "metrika", flow: "oauth", authorization_url: YANDEX_URL }),
      )
      .mockResolvedValueOnce(
        failure("AUTH_REQUIRED", "the code was rejected", "request a new code"),
      );
    const store = new ConnectorsStore();

    await store.connect("metrika", CONFIG);
    store.setCode("bad-code");
    await expect(store.finish(CONFIG)).resolves.toBe(false);

    expect(store.code).toBe("");
    expect(store.authorizationUrl).toBe(YANDEX_URL);
    expect(store.phase).toBe("error");
    expect(store.error?.nextAction).toBe("request a new code");
  });

  it("opens the consent URL only through the narrow opener", async () => {
    vi.mocked(runAuthLogin).mockResolvedValue(
      ok({ provider: "yandex", flow: "oauth", authorization_url: YANDEX_URL }),
    );
    const store = new ConnectorsStore();
    await store.connect("yandex", CONFIG);

    await expect(store.openAuthorizationUrl()).resolves.toBe(true);
    expect(openOAuthUrl).toHaveBeenCalledWith(YANDEX_URL);

    vi.mocked(openOAuthUrl).mockRejectedValue({
      code: "INVALID_ARGUMENT",
      message: "refusing to open a URL outside oauth.yandex.ru",
    });
    await expect(store.openAuthorizationUrl()).resolves.toBe(false);
    expect(store.openError?.code).toBe("INVALID_ARGUMENT");
    expect(store.phase).toBe("awaiting-code");
  });

  it("disables a second run while the first one is active", async () => {
    let resolveLogin!: (value: Envelope<AuthLoginData>) => void;
    vi.mocked(runAuthLogin).mockReturnValue(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    const store = new ConnectorsStore();

    const first = store.connect("gsc", CONFIG);
    expect(store.busy).toBe(true);
    await expect(store.connect("yandex", CONFIG)).resolves.toBe(false);
    expect(runAuthLogin).toHaveBeenCalledTimes(1);

    resolveLogin(ok({ provider: "gsc" }));
    await first;
    expect(store.busy).toBe(false);
  });

  it("drops grants and the in-flight state on reset", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      status([{ provider: "gsc_oauth", present: true }]),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);
    store.active = "gsc";
    store.phase = "connected";
    store.code = "abc";

    store.reset();

    expect(store.entries).toEqual([]);
    expect(store.presence("gsc")).toBe("unknown");
    expect(store.phase).toBe("idle");
    expect(store.active).toBeNull();
    expect(store.code).toBe("");
  });

  it("exposes OAuth readiness per provider and clears it on reset", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      ok({
        providers: [
          {
            provider: "gsc_oauth",
            secret: "",
            present: true,
            source: "keyring",
            expires_at: null,
          },
        ],
        present: ["gsc_oauth"],
        missing: ["yandex_oauth", "metrika_oauth"],
        oauth: {
          gsc: {
            state: "oauth_ready",
            detail: "ready",
            next_action: "",
            expires_at: null,
            scopes_recorded: true,
            limitations: [],
          },
          yandex: {
            state: "oauth_client_missing",
            detail: "missing",
            next_action: "create an app",
            expires_at: null,
            scopes_recorded: false,
            limitations: [],
          },
        },
      }),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    expect(store.oauth?.available).toBe(true);
    expect(store.readiness("gsc")?.state).toBe("oauth_ready");
    expect(store.readiness("yandex")?.nextAction).toBe("create an app");
    // A provider the engine skipped is not "ready".
    expect(store.readiness("metrika")).toBeNull();

    store.reset();

    expect(store.oauth).toBeNull();
    expect(store.readiness("gsc")).toBeNull();
  });

  it("marks readiness unavailable when the engine predates oauth diagnostics", async () => {
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    expect(store.oauth).toEqual({ available: false, entries: {} });
    expect(store.readiness("gsc")).toBeNull();
    expect(store.statusState).toBe("ready");
  });
});
