import { describe, expect, it, vi } from "vitest";

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

import {
  OAUTH_READINESS_STATES,
  normalizeOAuthReadiness,
  readinessLabelKey,
  readinessSeverity,
  readinessTone,
  type OAuthReadinessSeverity,
  type OAuthReadinessState,
} from "./oauthReadiness";

function entry(
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
    next_action: `${state} next`,
    limitations: [],
    ...overrides,
  };
}

function statusWith(oauth: unknown): Record<string, unknown> {
  return { providers: [], present: [], missing: [], oauth };
}

const EXPECTED_SEVERITY: Record<OAuthReadinessState, OAuthReadinessSeverity> = {
  oauth_client_missing: "action",
  oauth_client_secret_missing: "action",
  oauth_token_missing: "action",
  oauth_token_expired: "warning",
  oauth_scope_missing: "action",
  oauth_scope_unknown: "warning",
  oauth_redirect_invalid: "action",
  oauth_ready: "ready",
};

describe("normalizeOAuthReadiness", () => {
  it.each(OAUTH_READINESS_STATES)("parses the %s state", (state) => {
    const report = normalizeOAuthReadiness(
      statusWith({ gsc: entry(state), yandex: entry(state) }),
    );

    expect(report.available).toBe(true);
    expect(report.entries.gsc?.state).toBe(state);
    expect(report.entries.yandex?.state).toBe(state);
    // A provider the engine skipped stays absent instead of becoming ready.
    expect(report.entries.metrika).toBeUndefined();
    expect(readinessSeverity(report.entries.gsc ?? null)).toBe(
      EXPECTED_SEVERITY[state],
    );
    expect(readinessLabelKey(report.entries.gsc ?? null)).not.toBe(
      "connectors.oauth.unavailable",
    );
  });

  it("maps every state to a distinct short label and its severity", () => {
    const labels = OAUTH_READINESS_STATES.map((state) =>
      readinessLabelKey(
        normalizeOAuthReadiness(statusWith({ gsc: entry(state) })).entries
          .gsc ?? null,
      ),
    );
    expect(new Set(labels).size).toBe(OAUTH_READINESS_STATES.length);

    const tone = (state: string): string =>
      readinessTone(
        normalizeOAuthReadiness(statusWith({ gsc: entry(state) })).entries
          .gsc ?? null,
      );
    expect(tone("oauth_ready")).toBe("success");
    expect(tone("oauth_scope_unknown")).toBe("warning");
    expect(tone("oauth_token_expired")).toBe("warning");
    expect(tone("oauth_client_missing")).toBe("danger");
  });

  it("degrades a missing oauth object to unavailable", () => {
    expect(
      normalizeOAuthReadiness({ providers: [], present: [], missing: [] }),
    ).toEqual({ available: false, entries: {} });
    expect(normalizeOAuthReadiness(null)).toEqual({
      available: false,
      entries: {},
    });
    expect(normalizeOAuthReadiness({ oauth: "gsc" })).toEqual({
      available: false,
      entries: {},
    });
  });

  it("keeps an unknown state neutral instead of a false Ready", () => {
    const report = normalizeOAuthReadiness(
      statusWith({ gsc: entry("oauth_future_state") }),
    );
    const readiness = report.entries.gsc ?? null;

    expect(report.available).toBe(true);
    expect(readiness?.state).toBeNull();
    expect(readinessSeverity(readiness)).toBe("unknown");
    expect(readinessLabelKey(readiness)).toBe("connectors.oauth.unavailable");
    expect(readinessTone(readiness)).toBe("neutral");
  });

  it("normalizes the expiry, scope flag and limitations", () => {
    const report = normalizeOAuthReadiness(
      statusWith({
        gsc: entry("oauth_token_expired", {
          expires_at: null,
          scopes_recorded: false,
          limitations: ["an expired token without a refresh token", "", 7],
        }),
        yandex: entry("oauth_scope_unknown", {
          expires_at: undefined,
          scopes_recorded: "yes",
        }),
      }),
    );

    expect(report.entries.gsc).toMatchObject({
      expiresAt: null,
      scopesRecorded: false,
      limitations: ["an expired token without a refresh token"],
    });
    expect(report.entries.yandex).toMatchObject({
      expiresAt: null,
      scopesRecorded: null,
      limitations: [],
    });
  });

  it("drops fields the card does not render, including any token-like value", () => {
    const report = normalizeOAuthReadiness(
      statusWith({
        gsc: entry("oauth_ready", {
          access_token: "SECRET-ACCESS",
          refresh_token: "SECRET-REFRESH",
          client_secret: "SECRET-CLIENT",
          unexpected: "SECRET-EXTRA",
        }),
      }),
    );

    expect(Object.keys(report.entries.gsc ?? {}).sort()).toEqual([
      "detail",
      "expiresAt",
      "limitations",
      "nextAction",
      "provider",
      "scopesRecorded",
      "state",
    ]);
    expect(JSON.stringify(report)).not.toContain("SECRET");
  });
});
