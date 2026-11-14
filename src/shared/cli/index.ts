import { invoke } from "@tauri-apps/api/core";
import { errorMessage } from "@/shared/lib/errors";
import type {
  CliCommandId,
  CliRunOptions,
  Envelope,
} from "./types";

export {
  CLI_COMMAND_IDS,
  type CliCommandId,
  type CliError,
  type CliRunOptions,
  type CliRunRequest,
  type Envelope,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * The shell parses the CLI envelope and returns it over IPC. A JSON string is
 * accepted as well so a transport change does not break the UI silently.
 */
export function parseEnvelope<T>(raw: unknown): Envelope<T> {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return invalidEnvelope("cli_run returned a non-JSON string");
    }
  }
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return invalidEnvelope("cli_run returned a value that is not an envelope");
  }
  const meta = isRecord(value.meta) ? value.meta : {};
  const warnings = stringList(value.warnings);
  if (value.ok) {
    return { ok: true, data: value.data as T, meta, warnings };
  }
  const error = isRecord(value.error) ? value.error : {};
  return {
    ok: false,
    error: {
      code: typeof error.code === "string" ? error.code : "UNKNOWN",
      message:
        typeof error.message === "string"
          ? error.message
          : "The CLI returned an error without a message",
      next_action:
        typeof error.next_action === "string" ? error.next_action : undefined,
      retryable:
        typeof error.retryable === "boolean" ? error.retryable : undefined,
    },
    meta,
    warnings,
  };
}

function invalidEnvelope(message: string): Envelope<never> {
  return {
    ok: false,
    error: { code: "INVALID_ENVELOPE", message, retryable: false },
    meta: {},
    warnings: [],
  };
}

/**
 * Single IPC entry point for the allow-listed CLI commands. Never throws: a
 * shell/IPC failure becomes a typed `ok:false` envelope so stores and views
 * handle one shape.
 */
export async function cliRun<T>(
  commandId: CliCommandId,
  options: CliRunOptions = {},
): Promise<Envelope<T>> {
  const payload: Record<string, unknown> = {
    command: commandId,
  };
  if (options.args) {
    payload.args = options.args;
  }
  if (options.configPath) {
    payload.configPath = options.configPath;
  }
  try {
    const raw = await invoke<unknown>("cli_run", payload);
    return parseEnvelope<T>(raw);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "SHELL_UNAVAILABLE",
        message: errorMessage(error),
        retryable: true,
      },
      meta: {},
      warnings: [],
    };
  }
}

/** Shell/engine snapshot. The exact payload is owned by the Rust shell. */
export async function shellStatus<T>(): Promise<T> {
  return invoke<T>("shell_status");
}
