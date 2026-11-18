import { makeAutoObservable } from "mobx";
import type { AuthProviderStatus, AuthStatusData } from "@/entities/config";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  OAUTH_LOGIN_PROVIDERS,
  OAUTH_STATUS_PROVIDER,
  loadAuthStatus,
  openOAuthUrl,
  runAuthLogin,
  type AuthLoginData,
  type OAuthLoginProvider,
} from "../lib/ipc";
import {
  normalizeOAuthReadiness,
  type OAuthReadiness,
  type OAuthReadinessReport,
} from "./oauthReadiness";

export { OAUTH_LOGIN_PROVIDERS, type OAuthLoginProvider };

export type ConnectorPresence = "unknown" | "connected" | "not_connected";

export type ConnectorPhase =
  | "idle"
  | "starting"
  | "awaiting-code"
  | "finishing"
  | "connected"
  | "error";

export type ConnectorsStatusState = "idle" | "loading" | "ready" | "error";

/**
 * Presence comes from the provider entry, not from the length of the list: an
 * older engine or a partial `auth status` can omit a provider, and that is
 * unknown, not "not connected".
 */
export function connectorPresence(
  entries: readonly AuthProviderStatus[],
  provider: OAuthLoginProvider,
): ConnectorPresence {
  const entry = entries.find(
    (item) => item.provider === OAUTH_STATUS_PROVIDER[provider],
  );
  if (!entry) {
    return "unknown";
  }
  return entry.present ? "connected" : "not_connected";
}

/** A provider run is in flight: every Connect/Open/Finish control is disabled. */
export function isConnectorBusy(phase: ConnectorPhase): boolean {
  return phase === "starting" || phase === "finishing";
}

function envelopeError(code: string, message: string): AppError {
  return { code, message, retryable: false };
}

/**
 * The engine falls back to a manual instruction envelope when the OAuth client
 * id is not configured (older engines and the current manual fallback). That is
 * a setup problem, not a connection: surface its `next` command instead of
 * pretending the provider is connected.
 */
function manualFlowError(data: AuthLoginData | null): AppError {
  return {
    code: "AUTH_REQUIRED",
    message:
      "The engine returned manual login steps instead of an OAuth flow. Configure the OAuth client first.",
    nextAction:
      typeof data?.next === "string" && data.next.trim() !== ""
        ? data.next
        : undefined,
    retryable: false,
  };
}

/**
 * OAuth connector flow for the Integrations page.
 *
 * Google runs one blocking call: the engine opens the browser, listens on
 * `127.0.0.1` and stores the tokens before it answers. Yandex/Metrika run in
 * two steps: `urlOnly` returns the consent URL, then the pasted code is
 * exchanged once. Neither envelope contains a token, and the authorization
 * code is dropped from the store after the exchange.
 */
export class ConnectorsStore {
  statusState: ConnectorsStatusState = "idle";
  entries: AuthProviderStatus[] = [];
  /** `null` until `auth status` answers; `available: false` for engine < 0.14.0. */
  oauth: OAuthReadinessReport | null = null;
  statusError: AppError | null = null;
  active: OAuthLoginProvider | null = null;
  phase: ConnectorPhase = "idle";
  authorizationUrl = "";
  code = "";
  error: AppError | null = null;
  openError: AppError | null = null;
  /** True while the system browser is being asked to open the consent URL. */
  opening = false;
  private generation = 0;

  constructor() {
    makeAutoObservable<ConnectorsStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get busy(): boolean {
    return isConnectorBusy(this.phase);
  }

  get loading(): boolean {
    return this.statusState === "loading";
  }

  presence(provider: OAuthLoginProvider): ConnectorPresence {
    return connectorPresence(this.entries, provider);
  }

  /** OAuth readiness for one provider; `null` when the engine did not report it. */
  readiness(provider: OAuthLoginProvider): OAuthReadiness | null {
    return this.oauth?.entries[provider] ?? null;
  }

  /** True when the local OAuth app is missing or misconfigured; connecting cannot work yet. */
  setupRequired(provider: OAuthLoginProvider): boolean {
    const readiness = this.readiness(provider);
    if (readiness === null) {
      return false;
    }
    return (
      readiness.state === "oauth_client_missing" ||
      readiness.state === "oauth_client_secret_missing" ||
      readiness.state === "oauth_redirect_invalid"
    );
  }

  /** Drop the in-flight OAuth flow (workspace switch) but keep status entries. */
  resetFlow(): void {
    this.active = null;
    this.phase = "idle";
    this.authorizationUrl = "";
    this.code = "";
    this.error = null;
    this.openError = null;
    this.opening = false;
  }

  /** Drop every grant and in-flight state (workspace switch / teardown). */
  reset(): void {
    this.generation += 1;
    this.statusState = "idle";
    this.entries = [];
    this.oauth = null;
    this.statusError = null;
    this.resetFlow();
  }

  /**
   * Read `auth status`. A quiet refresh keeps the previous badges visible
   * while it runs, so a successful connect does not flash "Not checked".
   */
  async load(configPath: string | null, quiet = false): Promise<boolean> {
    const generation = ++this.generation;
    if (!configPath) {
      this.entries = [];
      this.oauth = null;
      this.statusState = "idle";
      this.statusError = null;
      return false;
    }
    if (!quiet) {
      this.statusState = "loading";
      this.statusError = null;
      this.entries = [];
      this.oauth = null;
    }
    const result = await loadAuthStatus(configPath);
    if (generation !== this.generation) {
      return false;
    }
    if (!result.ok) {
      this.entries = [];
      this.oauth = null;
      this.statusError = toAppError(result.error, "AUTH_STATUS");
      this.statusState = "error";
      return false;
    }
    const data = result.data as AuthStatusData | null;
    this.entries = data?.providers ?? [];
    this.oauth = normalizeOAuthReadiness(data);
    this.statusError = null;
    this.statusState = "ready";
    return true;
  }

  async connect(
    provider: OAuthLoginProvider,
    configPath: string | null,
  ): Promise<boolean> {
    if (this.busy) {
      return false;
    }
    this.active = provider;
    this.phase = "starting";
    this.authorizationUrl = "";
    this.code = "";
    this.error = null;
    this.openError = null;

    const result = await runAuthLogin(
      provider === "gsc" ? { provider } : { provider, urlOnly: true },
      configPath ?? undefined,
    );
    if (!result.ok) {
      this.phase = "error";
      this.error = toAppError(result.error, "AUTH_LOGIN");
      return false;
    }
    const data = result.data as AuthLoginData | null;
    if (provider === "gsc") {
      if (data?.flow !== "oauth") {
        this.phase = "error";
        this.error = manualFlowError(data);
        return false;
      }
      this.phase = "connected";
      await this.load(configPath, true);
      return true;
    }

    const url =
      typeof data?.authorization_url === "string"
        ? data.authorization_url.trim()
        : "";
    if (!url) {
      this.phase = "error";
      this.error =
        data?.flow === "manual"
          ? manualFlowError(data)
          : envelopeError(
              "INVALID_ENVELOPE",
              "auth login returned no authorization URL",
            );
      return false;
    }
    this.authorizationUrl = url;
    this.phase = "awaiting-code";
    return true;
  }

  setCode(value: string): void {
    this.code = value;
    this.error = null;
  }

  async finish(configPath: string | null): Promise<boolean> {
    const provider = this.active;
    const code = this.code.trim();
    if (this.phase !== "awaiting-code" || !provider || !code) {
      return false;
    }
    this.phase = "finishing";
    this.error = null;
    const result = await runAuthLogin({ provider, code }, configPath ?? undefined);
    // The authorization code is single-use; it must not stay in the store
    // after the exchange, whether the engine accepted it or not.
    this.code = "";
    if (!result.ok) {
      this.phase = "error";
      this.error = toAppError(result.error, "AUTH_LOGIN");
      return false;
    }
    this.authorizationUrl = "";
    this.phase = "connected";
    await this.load(configPath, true);
    return true;
  }

  async openAuthorizationUrl(): Promise<boolean> {
    if (!this.authorizationUrl || this.busy || this.opening) {
      return false;
    }
    this.openError = null;
    this.opening = true;
    try {
      await openOAuthUrl(this.authorizationUrl);
      return true;
    } catch (error) {
      this.openError = toAppError(error, "OPEN_URL");
      return false;
    } finally {
      this.opening = false;
    }
  }
}
