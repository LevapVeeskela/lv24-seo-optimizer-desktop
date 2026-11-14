import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { I18nProvider } from "@/shared/i18n";
import type { AuthProviderStatus } from "@/entities/config/model/types";
import { SecretModal } from "./SecretModal";

function status(
  provider: string,
  present: boolean,
  source = present ? "keyring" : "missing",
): AuthProviderStatus {
  return {
    provider,
    secret: `${provider}_token`,
    present,
    source,
  };
}

function render(provider: "gsc" | "yandex" | "metrika", entries: AuthProviderStatus[]) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <SecretModal
        open
        provider={provider}
        entries={entries}
        configPath="C:\\work\\seo.toml"
        onClose={() => {}}
        onChanged={() => {}}
      />
    </I18nProvider>,
  );
}

describe("SecretModal", () => {
  it("lists Metrika as its own provider next to Webmaster", () => {
    const html = render("metrika", [
      status("yandex", true),
      status("metrika", false),
    ]);

    expect(html).toContain('value="metrika"');
    expect(html).toContain("Yandex Metrika");
    expect(html).toContain("Yandex Webmaster");
    expect(html).toContain("Missing");
  });

  it("does not call an omitted provider missing", () => {
    const html = render("metrika", [status("yandex", true)]);

    expect(html).toContain("Unknown");
    expect(html).not.toContain("Missing");
  });

  it("shows the shared keychain contract", () => {
    const html = render("metrika", [status("metrika", true)]);

    expect(html).toContain("same OS keychain entry");
    expect(html).toContain("there is no second copy");
  });

  it("does not offer store/remove actions for an environment token", () => {
    const html = render("metrika", [status("metrika", true, "env")]);

    expect(html).toContain("environment variable");
    expect(html).not.toContain("Store token");
    expect(html).not.toContain("Remove token");
  });
});
