import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/app/providers/StoreProvider";
import type { RootStore } from "@/app/model/RootStore";
import { I18nProvider } from "@/shared/i18n";
import { IntegrationsPage } from "./IntegrationsPage";

function renderPage(offline = false): string {
  const engine = {
    status: {
      configPath: "C:\\ws\\seo.toml",
      platform: "windows",
      engine: { found: true, version: "0.5.3" },
    },
    loading: false,
    offline,
    load: vi.fn(),
  };
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <StoreProvider store={{ engine } as unknown as RootStore}>
        <MemoryRouter>
          <IntegrationsPage />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>,
  );
}

describe("IntegrationsPage", () => {
  it("renders both read-only panels with a copy-ready MCP snippet", () => {
    const html = renderPage();
    expect(html).toContain("Integrations");
    expect(html).toContain("MCP server for AI clients");
    expect(html).toContain("Scheduled runs");
    expect(html).toContain("mcpServers");
    expect(html).toContain("lv24-seo");
    expect(html).toContain("No artifact yet");
    expect(html).not.toContain("token=");
  });

  it("states that the schedule is print-only and installs nothing", () => {
    const html = renderPage();
    expect(html).toContain(
      "No cron entry, systemd unit or Windows task is created",
    );
    expect(html).toContain("Generate artifact");
  });

  it("keeps the MCP snippet when the engine is offline", () => {
    const html = renderPage(true);
    expect(html).toContain("mcpServers");
    expect(html).toContain("Engine status is unavailable");
    expect(html).toContain("Engine offline");
  });
});
