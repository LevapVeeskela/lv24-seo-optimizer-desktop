import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/app/providers/StoreProvider";
import type { RootStore } from "@/app/model/RootStore";
import { BackupStore } from "@/features/backup/model/BackupStore";
import { IndexingStore } from "@/features/indexing/model/IndexingStore";
import { ScheduleStore } from "@/features/schedule/model/ScheduleStore";
import { RunStore } from "@/shared/run/model/RunStore";
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
      <StoreProvider
        store={
          {
            engine,
            backup: new BackupStore(),
            schedule: new ScheduleStore(),
            indexing: new IndexingStore(),
            runs: new RunStore(),
          } as unknown as RootStore
        }
      >
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

  it("adds the OAuth connectors card for the three provider accounts", () => {
    const html = renderPage();
    expect(html).toContain("Provider connectors");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("Yandex Webmaster");
    expect(html).toContain("Yandex Metrika");
    expect(html).toContain("Not checked");
  });

  it("adds the local backup panel with a restore flow", () => {
    const html = renderPage();
    expect(html).toContain("Workspace backup");
    expect(html).toContain("Create backup");
    expect(html).toContain("No backup yet");
    expect(html).toContain("Restore from archive");
    expect(html).toContain("Review restore");
  });

  it("offers a host install mode next to the print-only preview", () => {
    const html = renderPage();
    expect(html).toContain("Preview artifact");
    expect(html).toContain("Install on this host");
  });
});
