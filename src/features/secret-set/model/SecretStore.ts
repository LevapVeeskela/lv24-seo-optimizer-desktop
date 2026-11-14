import { invoke } from "@tauri-apps/api/core";
import { makeAutoObservable } from "mobx";
import { parseEnvelope, type Envelope } from "@/shared/cli";
import type { MessageKey } from "@/shared/i18n";
import { toAppError, type AppError } from "@/shared/lib/errors";
import {
  runAuthStatus,
  type AuthProvider,
  type AuthProviderStatus,
  type AuthStatusData,
} from "@/entities/config";

export const SECRET_PROVIDER_KEYS: Record<AuthProvider, MessageKey> = {
  gsc: "secrets.provider.gsc",
  yandex: "secrets.provider.yandex",
  metrika: "secrets.provider.metrika",
  bing: "secrets.provider.bing",
  crux: "secrets.provider.crux",
  psi: "secrets.provider.psi",
  smtp: "secrets.provider.smtp",
  telegram: "secrets.provider.telegram",
};

export function secretSourceKey(source: string | undefined): MessageKey {
  switch (source) {
    case "env":
      return "secrets.source.env";
    case "keyring":
      return "secrets.source.keyring";
    case "file":
      return "secrets.source.file";
    case "missing":
      return "secrets.source.missing";
    default:
      return "secrets.source.unknown";
  }
}

export type SecretsState = "idle" | "loading" | "ready" | "error";

export type SecretPresence = "unknown" | "present" | "missing";

/**
 * Presence must be derived from the provider entry, not from the length of the
 * whole list: an older shell or a partial `auth status` can omit a provider,
 * and that is unknown, not "missing".
 */
export function secretPresence(
  entries: readonly AuthProviderStatus[],
  provider: string,
): SecretPresence {
  const entry = entries.find((item) => item.provider === provider);
  if (!entry) {
    return "unknown";
  }
  return entry.present ? "present" : "missing";
}

/**
 * Environment-provided secrets always win over the keychain. The window must
 * not offer store/remove actions that the engine would ignore.
 */
export function isSecretEditable(
  status: AuthProviderStatus | undefined,
): boolean {
  return status?.source !== "env";
}

/**
 * Compile-time expectations, verified against `src-tauri/src/commands.rs`:
 * `auth_set` and `auth_delete` pipe the value over stdin and never return it.
 * The shell may still reject the command at runtime (an old build, a denied
 * capability), so the actions also detect an unsupported-command rejection
 * and the modal degrades to the exact CLI command in that case.
 */
export const AUTH_SET_AVAILABLE = true;
export const AUTH_DELETE_AVAILABLE = true;

const UNSUPPORTED_COMMAND =
  /command .*not found|unknown command|not allowed|not supported|not registered|does not exist|no such command/i;

/** A missing or denied Tauri command, not a provider/engine failure. */
export function isUnsupportedCommand(error: unknown, fallbackCode = "AUTH_SET"): boolean {
  const appError = toAppError(error, fallbackCode);
  return (
    appError.code === "INVALID_COMMAND" ||
    appError.code === "COMMAND_NOT_FOUND" ||
    UNSUPPORTED_COMMAND.test(appError.message)
  );
}

export interface SecretActionResult {
  ok: boolean;
  unsupported: boolean;
  /** `auth logout` can succeed while an env/file source still supplies the token. */
  removed?: boolean;
  message?: string;
  envelope?: Envelope<unknown>;
}

interface RawCliRunResult {
  envelope?: unknown;
  exitCode?: number | null;
  stderr?: string;
}

export class SecretStore {
  state: SecretsState = "idle";
  entries: AuthProviderStatus[] = [];
  error: AppError | null = null;
  private generation = 0;

  constructor() {
    makeAutoObservable<SecretStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get present(): string[] {
    return this.entries
      .filter((entry) => entry.present)
      .map((entry) => entry.provider);
  }

  get(provider: string): AuthProviderStatus | undefined {
    return this.entries.find((entry) => entry.provider === provider);
  }

  async load(configPath: string | null): Promise<boolean> {
    const generation = ++this.generation;
    if (!configPath) {
      this.entries = [];
      this.state = "idle";
      this.error = null;
      return false;
    }
    this.state = "loading";
    this.error = null;
    // Drop the previous workspace's badges immediately; the modal reads
    // `entries` directly, so keeping them would show stale token presence.
    this.entries = [];
    const result = await runAuthStatus(configPath);
    if (generation !== this.generation) {
      return false;
    }
    if (result.ok) {
      const data = result.data as AuthStatusData | null;
      this.entries = data?.providers ?? [];
      this.state = "ready";
      return true;
    }
    this.entries = [];
    this.error = toAppError(result.error, "AUTH_STATUS");
    this.state = "error";
    return false;
  }
}

/**
 * Called only when the shell exposes `auth_set`. The value crosses IPC once,
 * is passed to the engine on stdin and is never stored by the webview.
 */
export async function storeSecret(
  provider: string,
  secret: string,
  configPath: string | null,
): Promise<SecretActionResult> {
  if (!AUTH_SET_AVAILABLE) {
    return { ok: false, unsupported: true };
  }
  try {
    const payload: Record<string, unknown> = { provider, secret };
    if (configPath) {
      payload.configPath = configPath;
    }
    const raw = await invoke<RawCliRunResult>("auth_set", payload);
    // `auth_set` returns CliRunResult, not the envelope itself.
    const envelope = parseEnvelope<unknown>(raw.envelope ?? raw);
    return {
      ok: envelope.ok,
      unsupported: false,
      message: envelope.ok ? undefined : envelope.error.message,
      envelope,
    };
  } catch (error) {
    const appError = toAppError(error, "AUTH_SET");
    return {
      ok: false,
      unsupported: isUnsupportedCommand(appError, "AUTH_SET"),
      message: appError.message,
    };
  }
}

export async function removeSecret(
  provider: string,
  configPath: string | null,
): Promise<SecretActionResult> {
  if (!AUTH_DELETE_AVAILABLE) {
    return { ok: false, unsupported: true };
  }
  try {
    const payload: Record<string, unknown> = { provider };
    if (configPath) {
      payload.configPath = configPath;
    }
    const raw = await invoke<RawCliRunResult>("auth_delete", payload);
    const envelope = parseEnvelope<unknown>(raw.envelope ?? raw);
    const data = envelope.ok
      ? (envelope.data as { deleted?: unknown } | null)
      : null;
    return {
      ok: envelope.ok,
      unsupported: false,
      // `deleted:false` means the keychain entry is gone but env/file still
      // supplies the token; claiming "removed" would be false.
      removed: envelope.ok ? data?.deleted !== false : undefined,
      message: envelope.ok ? undefined : envelope.error.message,
      envelope,
    };
  } catch (error) {
    const appError = toAppError(error, "AUTH_DELETE");
    return {
      ok: false,
      unsupported: isUnsupportedCommand(appError, "AUTH_DELETE"),
      message: appError.message,
    };
  }
}

export function authSetCommand(
  provider: string,
  configPath?: string | null,
): string {
  const suffix = configPath ? ` --config "${configPath}"` : "";
  return `lv24-seo auth set --provider ${provider} --stdin${suffix}`;
}

export function authDeleteCommand(
  provider: string,
  configPath?: string | null,
): string {
  const suffix = configPath ? ` --config "${configPath}"` : "";
  return `lv24-seo auth logout --provider ${provider} --json${suffix}`;
}
