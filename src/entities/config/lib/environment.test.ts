import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/entities/config/model/types";
import { environmentEntries } from "@/entities/config/lib/environment";

describe("environment entries", () => {
  it("marks a differing effective value as an override", () => {
    const source = defaultConfig();
    const effective = {
      report: { locale: "en", timezone: source.report.timezone },
    };
    const entries = environmentEntries(source, effective);
    expect(entries.find((entry) => entry.name === "LV24_SEO_REPORT_LOCALE")?.status).toBe(
      "detected",
    );
    expect(
      entries.find((entry) => entry.name === "LV24_SEO_REPORT_TIMEZONE")?.status,
    ).toBe("unknown");
  });

  it("never claims a secret value or path", () => {
    const entries = environmentEntries(defaultConfig(), {});
    const secret = entries.find((entry) => entry.name === "LV24_SEO_SMTP_PASSWORD");
    expect(secret).toMatchObject({ kind: "secret", status: "secret", path: null });
    expect(JSON.stringify(entries)).not.toContain("hunter2");
  });

  it("returns unknown when the effective config is unavailable", () => {
    const entries = environmentEntries(null, null);
    expect(entries.every((entry) => entry.status === "unknown" || entry.status === "secret")).toBe(
      true,
    );
  });
});
