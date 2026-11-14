export interface AppError {
  code: string;
  message: string;
  nextAction?: string;
  retryable: boolean;
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
