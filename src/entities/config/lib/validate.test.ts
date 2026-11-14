import { describe, expect, it } from "vitest";
import { defaultConfig } from "@/entities/config/model/types";
import { validateConfig } from "@/entities/config/lib/validate";

describe("config validation", () => {
  it("accepts the engine defaults", () => {
    const result = validateConfig(defaultConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("rejects an unknown locale and empty timezone", () => {
    const model = defaultConfig();
    (model.report as { locale: string }).locale = "de";
    model.report.timezone = "  ";
    const result = validateConfig(model);
    expect(result.valid).toBe(false);
    expect(result.errors.map((item) => item.path)).toEqual(
      expect.arrayContaining(["report.locale", "report.timezone"]),
    );
  });

  it("bounds the SMTP port to 1..65535", () => {
    const model = defaultConfig();
    model.report.email.smtp_port = 0;
    expect(validateConfig(model).errors.map((item) => item.path)).toContain(
      "report.email.smtp_port",
    );
    model.report.email.smtp_port = 65536;
    expect(validateConfig(model).errors.map((item) => item.path)).toContain(
      "report.email.smtp_port",
    );
    model.report.email.smtp_port = 65535;
    expect(validateConfig(model).valid).toBe(true);
  });

  it("rejects negative thresholds and a zero max URL bound", () => {
    const model = defaultConfig();
    model.report.thresholds.clicks_pct = -1;
    model.report.thresholds.position_abs = Number.NaN;
    model.crawl.max_urls = 0;
    const paths = validateConfig(model).errors.map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "report.thresholds.clicks_pct",
        "report.thresholds.position_abs",
        "crawl.max_urls",
      ]),
    );
  });

  it("keeps reserved numeric fields schema-valid", () => {
    const model = defaultConfig();
    model.crawl.concurrency = 0;
    model.storage.raw_retention_days = -1;
    const paths = validateConfig(model).errors.map((item) => item.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "crawl.concurrency",
        "storage.raw_retention_days",
      ]),
    );
  });

  it("warns about an enabled email channel with missing pieces", () => {
    const model = defaultConfig();
    model.report.email.enabled = true;
    const warnings = validateConfig(model).warnings.map((item) => item.path);
    expect(warnings).toEqual(
      expect.arrayContaining([
        "report.email.to",
        "report.email.smtp_host",
        "report.email.from",
      ]),
    );
  });

  it("warns about enabled Telegram and an empty PSI URL list", () => {
    const model = defaultConfig();
    model.report.telegram.enabled = true;
    model.providers.psi.present = true;
    const warnings = validateConfig(model).warnings.map((item) => item.path);
    expect(warnings).toEqual(
      expect.arrayContaining([
        "report.telegram.chat_id",
        "providers.psi.urls",
      ]),
    );
  });

  it("rejects a non-http base URL", () => {
    const model = defaultConfig();
    model.project.base_url = "example.com";
    const result = validateConfig(model);
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toBe("project.base_url");
    expect(result.errors[0].messageKey).toBe("settings.validation.baseUrl");
  });
});
