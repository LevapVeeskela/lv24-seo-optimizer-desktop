import { describe, expect, it } from "vitest";
import type { CliError } from "@/shared/cli";
import { mapInitError, validateSiteUrl } from "./wizard";

describe("validateSiteUrl", () => {
  it("accepts absolute http(s) URLs, localhost and sc-domain properties", () => {
    expect(validateSiteUrl("https://example.com")).toBeNull();
    expect(validateSiteUrl("http://localhost:3000")).toBeNull();
    expect(validateSiteUrl("  sc-domain:example.com ")).toBeNull();
  });

  it("requires a value and rejects relative or non-web URLs", () => {
    expect(validateSiteUrl("")).toBe("onboarding.error.siteRequired");
    expect(validateSiteUrl("   ")).toBe("onboarding.error.siteRequired");
    expect(validateSiteUrl("example.com")).toBe("onboarding.error.siteInvalid");
    expect(validateSiteUrl("ftp://example.com")).toBe(
      "onboarding.error.siteInvalid",
    );
    expect(validateSiteUrl("https://user:pass@example.com")).toBe(
      "onboarding.error.siteInvalid",
    );
    expect(validateSiteUrl("sc-domain:localhost")).toBe(
      "onboarding.error.siteInvalid",
    );
  });
});

describe("mapInitError", () => {
  it("gives an existing seo.toml its own code for the recovery UI", () => {
    const error: CliError = {
      code: "CONFIG_INVALID",
      message: "C:\\work\\alpha\\seo.toml already exists",
      next_action: "pass --force to overwrite it",
    };
    expect(mapInitError(error).code).toBe("ONBOARDING_CONFIG_EXISTS");
  });

  it("keeps other engine errors typed and unchanged", () => {
    const mapped = mapInitError({
      code: "INVALID_INPUT",
      message: "bad property",
      next_action: "use a URL",
    });
    expect(mapped.code).toBe("INVALID_INPUT");
    expect(mapped.nextAction).toBe("use a URL");
  });
});
