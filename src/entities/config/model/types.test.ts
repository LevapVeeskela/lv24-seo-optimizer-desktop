import { describe, expect, it } from "vitest";
import { AUTH_PROVIDERS, authProviderForConfigProvider } from "./types";

describe("auth provider mapping", () => {
  it("keeps Metrika and Webmaster tokens separate", () => {
    expect(authProviderForConfigProvider("yandex_webmaster")).toBe("yandex");
    expect(authProviderForConfigProvider("yandex_metrika")).toBe("metrika");
    expect(AUTH_PROVIDERS).toContain("metrika");
  });
});
