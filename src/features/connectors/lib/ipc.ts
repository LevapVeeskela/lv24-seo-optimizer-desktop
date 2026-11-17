import { invoke } from "@tauri-apps/api/core";
import { cliRun, type Envelope } from "@/shared/cli";
import type { AuthStatusData } from "@/entities/config";

/** Providers with an OAuth connector in the engine (`auth login`). */
export const OAUTH_LOGIN_PROVIDERS = ["gsc", "yandex", "metrika"] as const;
export type OAuthLoginProvider = (typeof OAUTH_LOGIN_PROVIDERS)[number];

/** `auth status` provider ids that record an OAuth grant, not a pasted token. */
export const OAUTH_STATUS_PROVIDER: Record<OAuthLoginProvider, string> = {
  gsc: "gsc_oauth",
  yandex: "yandex_oauth",
  metrika: "metrika_oauth",
};

/**
 * Token-free `auth login` summary. The engine stores the tokens itself and
 * never returns one; an unexpected field must not reach the view.
 */
export interface AuthLoginData {
  provider?: string;
  flow?: string;
  authorization_url?: string;
  scopes?: string[];
  expires_at?: string;
  target?: string;
  /** Manual fallback: the engine's next command and its steps. */
  next?: string;
  steps?: string[];
}

export interface AuthLoginArgs {
  provider: OAuthLoginProvider;
  noBrowser?: boolean;
  port?: number;
  code?: string;
  urlOnly?: boolean;
}

export function runAuthLogin(
  args: AuthLoginArgs,
  configPath?: string,
): Promise<Envelope<AuthLoginData>> {
  return cliRun<AuthLoginData>("auth_login", {
    args,
    ...(configPath ? { configPath } : {}),
  });
}

/** Status read shared with the secret modal; presence and source only. */
export function loadAuthStatus(
  configPath?: string | null,
): Promise<Envelope<AuthStatusData>> {
  return cliRun<AuthStatusData>(
    "auth_status",
    configPath ? { configPath } : {},
  );
}

/**
 * The Rust opener accepts only `https://oauth.yandex.ru/authorize?...`; this
 * is not a generic URL opener.
 */
export function openOAuthUrl(url: string): Promise<string> {
  return invoke<string>("open_oauth_url", { url });
}
