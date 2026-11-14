import { describe, expect, it } from "vitest";
import { defaultConfig, type ConfigModel } from "@/entities/config/model/types";
import {
  parseConfigToml,
  parseTomlValue,
  serializeConfig,
} from "@/entities/config/lib/toml";

const SAMPLE = `# workspace
[project]
name = "example.com" # inline comment
base_url = "https://example.com"
default_property = "sc-domain:example.com"

[providers.gsc]
property = "sc-domain:example.com"
auth = "keychain"

[providers.psi]
strategy = "desktop"
urls = [
  "https://example.com/",
  "https://example.com/pricing",
]

[report]
locale = "en"
timezone = "Europe/Minsk"
thresholds = { clicks_pct = 12.5, impressions_pct = 20, position_abs = 2 }

[report.email]
enabled = true
to = ["a@example.com", "b@example.com"]
from = "seo@example.com"
only_on_change = false
smtp_host = "smtp.example.com"
smtp_port = 2525
smtp_user = "seo@example.com"

[report.telegram]
enabled = true
chat_id = "123"
severity = "all"

[crawl]
max_urls = 42
concurrency = 2
respect_robots = false
user_agent = "bot/1.0 (+https://example.com/bot)"

[storage]
data_dir = "./data"
raw_retention_days = 0
`;

describe("config TOML", () => {
  it("parses the known schema with comments, arrays and inline tables", () => {
    const parsed = parseConfigToml(SAMPLE);
    const model = parsed.model;
    expect(model.project.name).toBe("example.com");
    expect(model.project.base_url).toBe("https://example.com");
    expect(model.providers.gsc.present).toBe(true);
    expect(model.providers.gsc.property).toBe("sc-domain:example.com");
    expect(model.providers.psi.strategy).toBe("desktop");
    expect(model.providers.psi.urls).toEqual([
      "https://example.com/",
      "https://example.com/pricing",
    ]);
    expect(model.report.locale).toBe("en");
    expect(model.report.thresholds).toEqual({
      clicks_pct: 12.5,
      impressions_pct: 20,
      position_abs: 2,
    });
    expect(model.report.email.to).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
    expect(model.report.email.from).toBe("seo@example.com");
    expect(model.report.email.smtp_port).toBe(2525);
    expect(model.report.email.only_on_change).toBe(false);
    expect(model.report.telegram.severity).toBe("all");
    expect(model.crawl.max_urls).toBe(42);
    expect(model.crawl.respect_robots).toBe(false);
    expect(model.crawl.user_agent).toBe(
      "bot/1.0 (+https://example.com/bot)",
    );
    expect(model.storage.raw_retention_days).toBe(0);
    expect(parsed.warnings).toEqual([]);
  });

  it("round-trips the known schema through the serializer", () => {
    const parsed = parseConfigToml(SAMPLE).model;
    const serialized = serializeConfig(parsed);
    const again = parseConfigToml(serialized).model;
    expect(again).toEqual(parsed);
  });

  it("omits absent provider blocks instead of inventing fields", () => {
    const serialized = serializeConfig(defaultConfig());
    expect(serialized).not.toContain("[providers.gsc]");
    expect(serialized).not.toContain("[providers.yandex_webmaster]");
    expect(serialized).toContain("[report.email]");
    expect(serialized).toContain('from = ""');
  });

  it("escapes strings and round-trips them", () => {
    const model = defaultConfig();
    model.project.name = 'A "quoted" \\ path\nnext\tline';
    const again = parseConfigToml(serializeConfig(model)).model;
    expect(again.project.name).toBe(model.project.name);
  });

  it("keeps comments inside strings and supports literal strings", () => {
    const parsed = parseConfigToml(
      '[project]\nname = "hash # not a comment"\ndefault_property = \'C:\\site\'\n',
    );
    expect(parsed.model.project.name).toBe("hash # not a comment");
    expect(parsed.model.project.default_property).toBe("C:\\site");
  });

  it("reports unknown keys instead of silently dropping them", () => {
    const parsed = parseConfigToml("[project]\nname = \"x\"\nunknown_key = 1\n");
    expect(parsed.unknownKeys).toContain("project.unknown_key");
  });

  it("marks provider blocks present when a table header appears", () => {
    const parsed = parseConfigToml("[providers.bing]\nsite = \"https://example.com\"\n");
    expect(parsed.model.providers.bing.present).toBe(true);
    expect(parsed.model.providers.bing.site).toBe("https://example.com");
  });

  it("parses scalar values defensively", () => {
    expect(parseTomlValue("true")).toBe(true);
    expect(parseTomlValue("1_000")).toBe(1000);
    expect(parseTomlValue('"a\\nb"')).toBe("a\nb");
    expect(parseTomlValue("[1, 2, 3]")).toEqual([1, 2, 3]);
    expect(parseTomlValue("not-a-value")).toBeUndefined();
  });

  it("does not emit a provider block that was never present", () => {
    const model: ConfigModel = defaultConfig();
    model.providers.gsc.property = "sc-domain:example.com";
    // Direct model mutation does not flip `present`; the form setter does.
    expect(serializeConfig(model)).not.toContain("[providers.gsc]");
  });
});
