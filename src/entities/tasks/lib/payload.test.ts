import { describe, expect, it } from "vitest";
import {
  displayUrl,
  findSecretPath,
  formatPayload,
  isSecretKey,
  redactPayload,
} from "./payload";

describe("task payload redaction", () => {
  it("finds credential-shaped keys but keeps ordinary token counts", () => {
    expect(isSecretKey("token")).toBe(true);
    expect(isSecretKey("gsc_token")).toBe(true);
    expect(isSecretKey("api_key")).toBe(true);
    expect(isSecretKey("Authorization")).toBe(true);
    expect(isSecretKey("token_count")).toBe(false);
    expect(isSecretKey("tokens")).toBe(false);

    expect(
      findSecretPath({ nested: { api_key: "x" }, list: [{ password: "p" }] }),
    ).toBe("payload.nested.api_key");
    expect(findSecretPath({ token_count: 2, tokens: ["a"] })).toBeNull();
  });

  it("replaces secret values at every depth without dropping evidence", () => {
    const redacted = redactPayload({
      months_stale: 16,
      token: "secret-value",
      nested: { password: "pw", ok: 1 },
      list: [{ authorization: "Bearer x" }],
    });
    const text = JSON.stringify(redacted);
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("pw");
    expect(text).not.toContain("Bearer x");
    expect(text).toContain("[redacted]");
    expect(text).toContain("months_stale");
    expect(text).toContain("token");
  });

  it("formats a redacted JSON preview for the disclosure", () => {
    const text = formatPayload({ rule: "decay-stale", secret: "hide-me" });
    expect(text).toContain("decay-stale");
    expect(text).toContain("[redacted]");
    expect(text).not.toContain("hide-me");
  });

  it("strips embedded URL credentials from the visible task URL", () => {
    expect(displayUrl("https://user:pass@example.com/a")).toBe(
      "https://example.com/a",
    );
    expect(displayUrl("/relative/path")).toBe("/relative/path");
  });
});
