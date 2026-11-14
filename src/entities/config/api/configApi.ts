import { invoke } from "@tauri-apps/api/core";
import { parseEnvelope, type Envelope } from "@/shared/cli";
import { errorMessage, toAppError, type AppError } from "@/shared/lib/errors";
import type {
  AuthStatusData,
  ConfigReadResult,
  ConfigValidateResult,
  ConfigWriteOutcome,
  ConfigPatch,
  ConfigPatchOutcome,
  DoctorCheck,
  DoctorData,
  DoctorRun,
} from "@/entities/config/model/types";

interface RawConfigReadResult {
  path: string;
  raw: string;
  dataDir?: string | null;
  resolvedPath?: string | null;
  config?: Record<string, unknown> | null;
  syntaxError?: string | null;
  envelope?: unknown;
  warnings?: string[];
  exitCode?: number | null;
  stderr?: string;
  engineError?: unknown;
}

interface RawConfigValidateResult {
  path: string;
  valid: boolean;
  syntaxError?: string | null;
  envelope?: unknown;
  exitCode?: number | null;
  stderr?: string;
}

export async function configRead(path: string): Promise<ConfigReadResult> {
  const raw = await invoke<RawConfigReadResult>("config_read", { path });
  return {
    path: raw.path,
    raw: raw.raw,
    dataDir: raw.dataDir ?? null,
    resolvedPath: raw.resolvedPath ?? null,
    config: raw.config ?? null,
    syntaxError: raw.syntaxError ?? null,
    envelope: raw.envelope ? parseEnvelope<unknown>(raw.envelope) : null,
    warnings: raw.warnings ?? [],
    exitCode: raw.exitCode ?? null,
    stderr: raw.stderr ?? "",
    engineError: raw.engineError ? toAppError(raw.engineError) : null,
  };
}

export async function configValidate(
  path: string,
  content: string,
): Promise<ConfigValidateResult> {
  const raw = await invoke<RawConfigValidateResult>("config_validate", {
    path,
    content,
  });
  return {
    path: raw.path,
    valid: raw.valid,
    syntaxError: raw.syntaxError ?? null,
    envelope: raw.envelope ? parseEnvelope<unknown>(raw.envelope) : null,
    exitCode: raw.exitCode ?? null,
    stderr: raw.stderr ?? "",
  };
}

export async function configWrite(
  path: string,
  content: string,
): Promise<ConfigWriteOutcome> {
  return invoke<ConfigWriteOutcome>("config_write", { path, content });
}

interface RawConfigPatchResult {
  path: string;
  raw: string;
  backup?: string | null;
  bytes: number;
  config?: Record<string, unknown> | null;
  warnings?: string[];
  engineError?: unknown;
}

/**
 * Apply field-level patches through `toml_edit` in the shell. Comments, key
 * order and unrelated formatting survive, unlike a full-file rewrite.
 */
export async function configPatch(
  path: string,
  patches: ConfigPatch[],
): Promise<ConfigPatchOutcome> {
  const raw = await invoke<RawConfigPatchResult>("config_patch", {
    path,
    patches,
  });
  return {
    path: raw.path,
    raw: raw.raw,
    backup: raw.backup ?? null,
    bytes: raw.bytes,
    config: raw.config ?? null,
    warnings: raw.warnings ?? [],
    engineError: raw.engineError ? toAppError(raw.engineError) : null,
  };
}

/** The shell's `open_path` is allow-listed to config/data/log roots. */
export async function openPath(path: string): Promise<void> {
  await invoke("open_path", { path });
}

function unavailable(message: string): Envelope<never> {
  return {
    ok: false,
    error: { code: "SHELL_UNAVAILABLE", message, retryable: true },
    meta: {},
    warnings: [],
  };
}

interface RawCliRunResult {
  command?: string;
  exitCode?: number | null;
  envelope?: unknown;
  stderr?: string;
  durationMs?: number;
  truncated?: boolean;
}

/**
 * `auth_status` is in the Rust `cli_run` allow-list but not in the narrower
 * `CLI_COMMAND_IDS` union used by shared/cli. `cli_run` returns a `CliRunResult`
 * wrapper, so unwrap `envelope` before parsing.
 */
export async function runAuthStatus(
  configPath: string | null,
): Promise<Envelope<AuthStatusData>> {
  const payload: Record<string, unknown> = {
    command: "auth_status",
  };
  if (configPath) {
    payload.configPath = configPath;
  }
  try {
    const raw = await invoke<RawCliRunResult>("cli_run", payload);
    return parseEnvelope<AuthStatusData>(raw.envelope ?? raw);
  } catch (error) {
    return unavailable(errorMessage(error));
  }
}

function asChecks(value: unknown): DoctorCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is DoctorCheck => {
    if (typeof item !== "object" || item === null) {
      return false;
    }
    const candidate = item as { id?: unknown; ok?: unknown; detail?: unknown };
    return (
      typeof candidate.id === "string" &&
      typeof candidate.ok === "boolean" &&
      typeof candidate.detail === "string"
    );
  });
}

export async function runDoctor(
  configPath: string | null,
): Promise<DoctorRun> {
  const ranAt = new Date().toISOString();
  try {
    const payload: Record<string, unknown> = { command: "doctor" };
    if (configPath) {
      payload.configPath = configPath;
    }
    const raw = await invoke<RawCliRunResult>("cli_run", payload);
    const result = parseEnvelope<DoctorData>(raw.envelope ?? raw);
    const data = result.ok ? result.data : null;
    const checks = asChecks(
      data?.checks ?? (result.meta as Record<string, unknown>).checks,
    );
    return {
      ok: result.ok,
      healthy: data?.healthy ?? result.meta.healthy === true,
      checks,
      message: result.ok ? null : result.error.message,
      meta: result.meta,
      warnings: result.warnings,
      ranAt,
    };
  } catch (error) {
    return {
      ok: false,
      healthy: false,
      checks: [],
      message: errorMessage(error),
      meta: {},
      warnings: [],
      ranAt,
    };
  }
}

export type { AppError };
