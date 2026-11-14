import { describe, expect, it } from "vitest";
import { redactToml } from "@/entities/config/lib/redact";

describe("redactToml", () => {
  it("redacts secret-looking keys and keeps ordinary fields", () => {
    const raw = [
      "[providers.gsc]",
      'property = "sc-domain:example.com"',
      'auth = "keychain"',
      "[report.email]",
      'smtp_password = "hunter2"',
      'smtp_user = "seo@example.com"',
    ].join("\n");
    const redacted = redactToml(raw);
    expect(redacted).toContain('property = "sc-domain:example.com"');
    expect(redacted).toContain('auth = "keychain"');
    expect(redacted).toContain('smtp_password = "***"');
    expect(redacted).toContain('smtp_user = "seo@example.com"');
    expect(redacted).not.toContain("hunter2");
  });

  it("redacts inline table values without touching comments", () => {
    const raw = [
      'auth = { api_key = "abc", name = "ok" }',
      '# token = "keep the comment"',
    ].join("\n");
    const redacted = redactToml(raw);
    expect(redacted).toContain('api_key = "***"');
    expect(redacted).toContain('name = "ok"');
    expect(redacted).toContain('# token = "***"');
  });
});
