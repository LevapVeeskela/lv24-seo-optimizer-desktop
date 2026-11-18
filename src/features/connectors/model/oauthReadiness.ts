import type { MessageKey } from "@/shared/i18n";
import { isRecord, stringValue } from "@/shared/lib/format";
import { OAUTH_LOGIN_PROVIDERS, type OAuthLoginProvider } from "../lib/ipc";

/**
 * OAuth readiness diagnostics from `auth status --json` (engine >= 0.14.0).
 *
 * The engine reports one stable state per provider plus a human-readable
 * `detail`, a `next_action`, the non-secret expiry and whether scopes were
 * recorded. Token values are never part of this payload, and this module only
 * copies the fields the card renders, so an unexpected field cannot leak.
 */
export const OAUTH_READINESS_STATES = [
  "oauth_client_missing",
  "oauth_client_secret_missing",
  "oauth_token_missing",
  "oauth_token_expired",
  "oauth_scope_missing",
  "oauth_scope_unknown",
  "oauth_redirect_invalid",
  "oauth_ready",
] as const;

export type OAuthReadinessState = (typeof OAUTH_READINESS_STATES)[number];

/** ready: all checks pass; action: setup blocks the connector; warning: degraded. */
export type OAuthReadinessSeverity = "ready" | "action" | "warning" | "unknown";

export interface OAuthReadiness {
  provider: OAuthLoginProvider;
  /** `null` when the engine reported a state this build does not know. */
  state: OAuthReadinessState | null;
  detail: string | null;
  nextAction: string | null;
  expiresAt: string | null;
  scopesRecorded: boolean | null;
  limitations: string[];
}

export interface OAuthReadinessReport {
  /** False when `auth status` carried no `oauth` object (engine < 0.14.0). */
  available: boolean;
  entries: Partial<Record<OAuthLoginProvider, OAuthReadiness>>;
}

const STATE_SEVERITY: Record<OAuthReadinessState, OAuthReadinessSeverity> = {
  oauth_client_missing: "action",
  oauth_client_secret_missing: "action",
  oauth_token_missing: "action",
  // An expired token is renewed by the next read when a refresh token is
  // stored; the engine's detail says which case applies, so it stays a warning.
  oauth_token_expired: "warning",
  oauth_scope_missing: "action",
  // Missing scope history is a limitation, never a failure.
  oauth_scope_unknown: "warning",
  oauth_redirect_invalid: "action",
  oauth_ready: "ready",
};

const STATE_LABEL: Record<OAuthReadinessState, MessageKey> = {
  oauth_client_missing: "connectors.oauth.clientMissing",
  oauth_client_secret_missing: "connectors.oauth.clientSecretMissing",
  oauth_token_missing: "connectors.oauth.tokenMissing",
  oauth_token_expired: "connectors.oauth.tokenExpired",
  oauth_scope_missing: "connectors.oauth.scopeMissing",
  oauth_scope_unknown: "connectors.oauth.scopeUnknown",
  oauth_redirect_invalid: "connectors.oauth.redirectInvalid",
  oauth_ready: "connectors.oauth.ready",
};

function normalizeState(value: string | null): OAuthReadinessState | null {
  return value !== null &&
    (OAUTH_READINESS_STATES as readonly string[]).includes(value)
    ? (value as OAuthReadinessState)
    : null;
}

function normalizeEntry(
  provider: OAuthLoginProvider,
  value: unknown,
): OAuthReadiness | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    provider,
    state: normalizeState(stringValue(value.state)),
    detail: stringValue(value.detail),
    nextAction: stringValue(value.next_action),
    expiresAt: stringValue(value.expires_at),
    scopesRecorded:
      typeof value.scopes_recorded === "boolean"
        ? value.scopes_recorded
        : null,
    limitations: Array.isArray(value.limitations)
      ? value.limitations.filter(
          (item): item is string =>
            typeof item === "string" && item.trim() !== "",
        )
      : [],
  };
}

/**
 * Parse `data.oauth` defensively. A missing object means the engine predates
 * the diagnostics; a missing or unrecognised provider entry degrades to the
 * neutral "unavailable" row instead of a false "Ready".
 */
export function normalizeOAuthReadiness(data: unknown): OAuthReadinessReport {
  const root = isRecord(data) ? data : {};
  if (!isRecord(root.oauth)) {
    return { available: false, entries: {} };
  }
  const entries: Partial<Record<OAuthLoginProvider, OAuthReadiness>> = {};
  for (const provider of OAUTH_LOGIN_PROVIDERS) {
    const entry = normalizeEntry(provider, root.oauth[provider]);
    if (entry) {
      entries[provider] = entry;
    }
  }
  return { available: true, entries };
}

export function readinessSeverity(
  readiness: OAuthReadiness | null,
): OAuthReadinessSeverity {
  if (!readiness || !readiness.state) {
    return "unknown";
  }
  return STATE_SEVERITY[readiness.state];
}

export function readinessLabelKey(
  readiness: OAuthReadiness | null,
): MessageKey {
  return readiness?.state
    ? STATE_LABEL[readiness.state]
    : "connectors.oauth.unavailable";
}

export function readinessTone(
  readiness: OAuthReadiness | null,
): "success" | "warning" | "danger" | "neutral" {
  switch (readinessSeverity(readiness)) {
    case "ready":
      return "success";
    case "action":
      return "danger";
    case "warning":
      return "warning";
    default:
      return "neutral";
  }
}
