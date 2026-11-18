import { renderToStaticMarkup } from "react-dom/server";
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
import { I18nProvider } from "@/shared/i18n";
import { loadAuthStatus, runAuthLogin } from "../lib/ipc";
import { ConnectorsStore } from "../model/ConnectorsStore";
import { ConnectorsCard } from "./ConnectorsCard";

const CONFIG = "C:\\ws\\seo.toml";
const YANDEX_URL =
  "https://oauth.yandex.ru/authorize?response_type=code&client_id=abc&state=xyz";

function ok<T>(data: T): Envelope<T> {
  return { ok: true, data, meta: {}, warnings: [] };
}

function statusData(): AuthStatusData {
  return {
    providers: [
      {
        provider: "gsc_oauth",
        secret: "",
        present: true,
        source: "keyring",
        expires_at: null,
      },
      {
        provider: "yandex_oauth",
        secret: "",
        present: false,
        source: "missing",
        expires_at: null,
      },
      {
        provider: "metrika_oauth",
        secret: "",
        present: false,
        source: "missing",
        expires_at: null,
      },
    ],
    present: ["gsc_oauth"],
    missing: ["yandex_oauth", "metrika_oauth"],
  };
}

function oauthEntry(
  state: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider: "gsc",
    state,
    detail: `${state} detail`,
    client_id_present: true,
    client_secret_present: true,
    access_token_present: true,
    refresh_token_present: true,
    expires_at: "2026-11-18T12:00:00+00:00",
    scopes_recorded: true,
    next_action: "",
    limitations: [],
    ...overrides,
  };
}

function statusWithOAuth(
  oauth: Record<string, unknown>,
): AuthStatusData {
  return { ...statusData(), oauth };
}

function render(store: ConnectorsStore, blocked = false): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <ConnectorsCard
        store={store}
        configPath={CONFIG}
        blocked={blocked}
      />
    </I18nProvider>,
  );
}

describe("ConnectorsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadAuthStatus).mockResolvedValue(ok(statusData()));
    vi.mocked(runAuthLogin).mockResolvedValue(ok({ provider: "gsc" }));
  });

  it("shows Connected and Not connected from auth status", async () => {
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html).toContain("Provider connectors");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Yandex Webmaster");
    expect(html).toContain("Yandex Metrika");
    expect(html).toContain("Connected");
    expect(html.match(/Not connected/g)).toHaveLength(2);
    expect(html).toContain("Connect");
  });

  it("asks the user to finish Google sign-in in the browser", () => {
    const store = new ConnectorsStore();
    store.active = "gsc";
    store.phase = "starting";

    const html = render(store);

    expect(html).toContain(
      "Complete the sign-in in your browser. This window waits for the callback.",
    );
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("shows the Yandex URL, opener and code field", () => {
    const store = new ConnectorsStore();
    store.active = "yandex";
    store.phase = "awaiting-code";
    store.authorizationUrl = YANDEX_URL;

    const html = render(store);

    expect(html).toContain("Open Yandex");
    expect(html).toContain("Authorization code");
    expect(html).toContain("oauth.yandex.ru/verification_code");
    // React escapes `&` in text, so assert the stable URL prefix.
    expect(html).toContain(
      "https://oauth.yandex.ru/authorize?response_type=code",
    );
    expect(html).toContain("client_id=abc");
    expect(html).toContain("Finish");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("refresh_token");
  });

  it("shows the engine next_action and the auth docs on setup errors", () => {
    const store = new ConnectorsStore();
    store.active = "gsc";
    store.phase = "error";
    store.error = {
      code: "AUTH_REQUIRED",
      message: "Google OAuth client_id is not configured",
      nextAction: "lv24-seo auth set --provider gsc_oauth_secret --stdin",
      retryable: false,
    };

    const html = render(store);

    expect(html).toContain("Connection failed");
    expect(html).toContain("Google OAuth client_id is not configured");
    expect(html).toContain(
      "lv24-seo auth set --provider gsc_oauth_secret --stdin",
    );
    expect(html).toContain("Engine auth guide");
    expect(html).toContain("https://github.com/LevapVeeskela/lv24-seo-optimizer/blob/main/docs/auth.md");
    expect(html).toContain("AUTH_REQUIRED");
  });

  it("never renders a token even if an envelope carried an unexpected field", async () => {
    vi.mocked(runAuthLogin).mockResolvedValue(
      ok({
        provider: "gsc",
        flow: "oauth",
        // The engine never returns a token; prove the view ignores one anyway.
        access_token: "SECRET-TOKEN",
        refresh_token: "SECRET-REFRESH",
      } as never),
    );
    const store = new ConnectorsStore();
    await store.connect("gsc", CONFIG);

    const html = render(store);

    expect(html).not.toContain("SECRET-TOKEN");
    expect(html).not.toContain("SECRET-REFRESH");
    expect(html).toContain("Connected");
  });

  it("explains a missing workspace and disables Connect", () => {
    const html = render(new ConnectorsStore(), true);

    expect(html).toContain("Connectors need a workspace");
    expect(html).toContain("disabled");
  });

  it("renders readiness state, detail, next action, expiry and scopes", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      ok(
        statusWithOAuth({
          gsc: oauthEntry("oauth_ready", {
            detail:
              "Google Search Console OAuth client, secret, token, scopes and redirect are ready",
          }),
          yandex: oauthEntry("oauth_token_expired", {
            detail:
              "access token expired at 2026-11-17T00:00:00+00:00; refresh token present (refresh available)",
            next_action:
              "run a read command (the token refreshes automatically) or `lv24-seo auth login --provider yandex`",
            expires_at: "2026-11-17T00:00:00+00:00",
          }),
          metrika: oauthEntry("oauth_scope_unknown", {
            detail:
              "token scopes were never recorded; run a login or a refresh once to record them",
            next_action:
              "run `lv24-seo auth login --provider metrika` or a read command (a refresh records the granted scopes)",
            expires_at: null,
            scopes_recorded: false,
            limitations: [
              "token scopes were never recorded, so scope coverage is unknown, not passed",
            ],
          }),
        }),
      ),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html).toContain(">Ready<");
    expect(html).toContain("Token expired");
    expect(html).toContain("Scopes unknown");
    expect(html).toContain(
      "refresh token present (refresh available)",
    );
    expect(html).toContain(
      "A stored refresh token renews the access token on the next read",
    );
    expect(html).toContain("Next step");
    expect(html).toContain(
      "lv24-seo auth login --provider metrika",
    );
    expect(html).toContain("Scopes recorded");
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect(html).toContain("Limitations");
    expect(html).toContain(
      "token scopes were never recorded, so scope coverage is unknown, not passed",
    );
    // The expiry cell is localized; the engine's own detail stays verbatim.
    expect(html).toMatch(/<dd>[^<]*2026[^<]*<\/dd>/);
    expect(html).not.toMatch(/<dd>2026-11-17T00:00:00/);
    expect(html).toContain("<dd>—</dd>");
  });

  it("shows a neutral notice when the engine has no oauth diagnostics", async () => {
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html).toContain("Readiness unavailable");
    expect(html).toContain("OAuth readiness needs engine 0.14.0 or newer");
    expect(html).not.toContain(">Ready<");
    // The presence rows keep working.
    expect(html).toContain("Connected");
    expect(html.match(/Not connected/g)).toHaveLength(2);
  });

  it("keeps an unknown readiness state neutral, never Ready", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      ok(
        statusWithOAuth({
          gsc: oauthEntry("oauth_from_the_future"),
          yandex: oauthEntry("oauth_ready"),
          metrika: oauthEntry("oauth_ready"),
        }),
      ),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html.match(/>Ready</g)).toHaveLength(2);
    expect(html).toContain("Readiness unavailable");
    expect(html).toContain("OAuth readiness needs engine 0.14.0 or newer");
  });

  it("treats a provider missing from oauth as unavailable", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      ok(
        statusWithOAuth({
          gsc: oauthEntry("oauth_ready"),
          yandex: oauthEntry("oauth_ready"),
        }),
      ),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html.match(/>Ready</g)).toHaveLength(2);
    expect(html).toContain("Readiness unavailable");
  });

  it("never renders a token or secret seeded in auth status", async () => {
    vi.mocked(loadAuthStatus).mockResolvedValue(
      ok({
        providers: [
          {
            provider: "gsc_oauth",
            secret: "SECRET-PRESENCE",
            present: true,
            source: "keyring",
            expires_at: null,
          },
        ],
        present: ["gsc_oauth"],
        missing: ["yandex_oauth", "metrika_oauth"],
        oauth: {
          gsc: oauthEntry("oauth_ready", {
            access_token: "SECRET-ACCESS",
            refresh_token: "SECRET-REFRESH",
            client_secret: "SECRET-CLIENT",
          }),
          yandex: oauthEntry("oauth_token_expired", {
            access_token: "SECRET-YANDEX",
            refresh_token: "SECRET-YANDEX-REFRESH",
          }),
          metrika: oauthEntry("oauth_scope_unknown", {
            access_token: "SECRET-METRIKA",
          }),
        },
      }),
    );
    const store = new ConnectorsStore();
    await store.load(CONFIG);

    const html = render(store);

    expect(html).not.toContain("SECRET");
  });
});
