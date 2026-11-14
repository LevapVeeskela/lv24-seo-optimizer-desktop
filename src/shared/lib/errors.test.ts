import { describe, expect, it } from "vitest";
import { appErrorText, errorCodeKey, toAppError } from "./errors";

describe("typed error helpers", () => {
  it("maps stable write/config codes to localized explanations", () => {
    expect(errorCodeKey("WRITE_DISABLED")).toBe("errors.writeDisabled");
    expect(errorCodeKey("CONFIRM_REQUIRED")).toBe("errors.confirmRequired");
    expect(errorCodeKey("CONFIG_INVALID")).toBe("errors.configInvalid");
    expect(errorCodeKey("PATH_NOT_ALLOWED")).toBe("errors.pathNotAllowed");
    expect(errorCodeKey("UNKNOWN_PROVIDER_CODE")).toBeNull();
  });

  it("keeps the engine message and appends its next action", () => {
    expect(
      appErrorText({
        code: "AUTH_INVALID",
        message: "token expired",
        nextAction: "run auth set",
        retryable: false,
      }),
    ).toBe("token expired run auth set");
  });

  it("preserves snake_case next_action from an engine error", () => {
    const error = toAppError({
      code: "WRITE_DISABLED",
      message: "writes are disabled",
      next_action: "remove --allow-write",
      retryable: false,
    });
    expect(error.code).toBe("WRITE_DISABLED");
    expect(error.nextAction).toBe("remove --allow-write");
    expect(appErrorText(error)).toBe(
      "writes are disabled remove --allow-write",
    );
  });
});
