import { describe, expect, it } from "vitest";
import { classifyUpdateError } from "./errors";

describe("classifyUpdateError", () => {
  it.each([
    "Signature verification failed",
    "minisign: invalid signature",
    "The update was signed for version 1.0.0 but the update endpoint announced version 2.0.0.",
    "The update signature does not specify the version it was signed for",
  ])("treats signature failures as security: %s", (message) => {
    expect(classifyUpdateError(new Error(message))).toBe("security");
  });

  it.each([
    "Could not fetch a valid release JSON from the remote",
    "the platform `windows-x86_64-nsis` was not found in the response `platforms` object",
    "TargetNotFound",
    "None of the fallback platforms were found",
  ])("treats a missing artifact as unsupported: %s", (message) => {
    expect(classifyUpdateError(new Error(message))).toBe("unsupported");
  });

  it.each([
    "error sending request: connection timed out",
    "failed to fetch",
    "network error",
    "dns error",
  ])("treats transport failures as offline: %s", (message) => {
    expect(classifyUpdateError(new Error(message))).toBe("offline");
  });

  it("falls back to generic for unknown failures", () => {
    expect(classifyUpdateError(new Error("unexpected deserialization failure"))).toBe(
      "generic",
    );
    expect(classifyUpdateError("plain string failure")).toBe("generic");
  });
});
