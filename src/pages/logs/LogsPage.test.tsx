import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/app/providers/StoreProvider";
import type { RootStore } from "@/app/model/RootStore";
import { LogsStore } from "@/entities/logs";
import { LOCALES, I18nProvider, translate } from "@/shared/i18n";
import { LogsPage } from "./LogsPage";

function renderPage(offline = false): string {
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
      <StoreProvider store={{ engine, logs: new LogsStore() } as unknown as RootStore}>
        <MemoryRouter>
          <LogsPage />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>,
  );
}

describe("LogsPage", () => {
  it("renders the picker, the bot filter and the empty state", () => {
    const html = renderPage();
    expect(html).toContain("Crawl log analysis");
    expect(html).toContain("Choose log file");
    expect(html).toContain("No log file selected");
    expect(html).toContain("All requests");
    expect(html).toContain("Analyze log");
    expect(html).toContain("No analysis yet");
  });

  it("states that nothing is uploaded and the file is never modified", () => {
    const html = renderPage();
    expect(html).toContain("Nothing is uploaded");
    expect(html).toContain("file is never modified");
  });

  it("explains an offline engine without hiding the form", () => {
    const html = renderPage(true);
    expect(html).toContain("Engine offline");
    expect(html).toContain("Choose log file");
  });

  it("keeps the UA-only limitation honest in every locale", () => {
    for (const locale of LOCALES) {
      const hint = translate(locale, "logs.uaHint");
      expect(hint).toContain("User-Agent");
      expect(hint.length).toBeGreaterThan(60);
    }
  });
});
