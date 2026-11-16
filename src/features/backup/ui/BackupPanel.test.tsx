import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/app/providers/StoreProvider";
import type { RootStore } from "@/app/model/RootStore";
import { I18nProvider } from "@/shared/i18n";
import { BackupPanel } from "./BackupPanel";

function renderPanel(offline = false): string {
  const engine = {
    status: offline
      ? null
      : {
          configPath: "C:\\ws\\seo.toml",
          platform: "windows",
          paths: { exportDir: "C:\\exports" },
          engine: { found: true, version: "0.5.4" },
        },
    loading: false,
    offline,
    load: vi.fn(),
  };
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <StoreProvider store={{ engine } as unknown as RootStore}>
        <MemoryRouter>
          <BackupPanel />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>,
  );
}

describe("BackupPanel", () => {
  it("renders the local backup controls and the empty state", () => {
    const html = renderPanel();
    expect(html).toContain("Workspace backup");
    expect(html).toContain("Choose folder");
    expect(html).toContain("No backup yet");
    expect(html).toContain("Create backup");
    expect(html).toContain("No folder selected");
  });

  it("renders the two-phase restore flow", () => {
    const html = renderPanel();
    expect(html).toContain("Restore from archive");
    expect(html).toContain("Choose archive");
    expect(html).toContain("Review restore");
    expect(html).toContain("No restore planned");
    expect(html).toContain("Restore this backup?");
  });

  it("keeps the panel but explains an offline engine", () => {
    const html = renderPanel(true);
    expect(html).toContain("Engine offline");
    expect(html).toContain("Restore from archive");
  });
});
