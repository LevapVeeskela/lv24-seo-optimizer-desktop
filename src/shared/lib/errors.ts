import type { MessageKey } from "@/shared/i18n";

export interface AppError {
  code: string;
  message: string;
  nextAction?: string;
  retryable: boolean;
}

/**
 * Stable engine/shell codes that deserve a localized explanation in addition
 * to the provider message. Unknown codes stay raw: inventing text for them
 * would hide the engine's own next_action.
 */
const ERROR_CODE_KEYS: Record<string, MessageKey> = {
  WRITE_DISABLED: "errors.writeDisabled",
  CONFIRM_REQUIRED: "errors.confirmRequired",
  CONFIG_INVALID: "errors.configInvalid",
  PATH_NOT_ALLOWED: "errors.pathNotAllowed",
  SHELL_UNAVAILABLE: "errors.shellUnavailable",
};

export function errorCodeKey(code: string): MessageKey | null {
  return ERROR_CODE_KEYS[code] ?? null;
}

/** One visible string for a typed error, including the engine's next action. */
export function appErrorText(error: AppError): string {
  return error.nextAction
    ? `${error.message} ${error.nextAction}`
    : error.message;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function toAppError(
  error: unknown,
  fallbackCode = "UNKNOWN",
): AppError {
  if (typeof error === "object" && error !== null) {
    const candidate = error as {
      code?: unknown;
      message?: unknown;
      next_action?: unknown;
      nextAction?: unknown;
      retryable?: unknown;
    };
    if (typeof candidate.message === "string") {
      const nextAction =
        typeof candidate.nextAction === "string"
          ? candidate.nextAction
          : typeof candidate.next_action === "string"
            ? candidate.next_action
            : undefined;
      return {
        code:
          typeof candidate.code === "string" ? candidate.code : fallbackCode,
        message: candidate.message,
        nextAction,
        retryable: candidate.retryable === true,
      };
    }
  }
  return {
    code: fallbackCode,
    message: errorMessage(error),
    retryable: false,
  };
}
