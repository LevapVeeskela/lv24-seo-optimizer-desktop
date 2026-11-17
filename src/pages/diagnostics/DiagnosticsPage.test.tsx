import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StoreProvider } from "@/app/providers/StoreProvider";
import type { RootStore } from "@/app/model/RootStore";
import { DiagnosticsStore } from "@/features/diagnostics";
import { I18nProvider, LOCALES, translate } from "@/shared/i18n";
import { DiagnosticsPage } from "./DiagnosticsPage";

function renderPage(offline = false): string {
  const engine = {
    status: offline
      ? null
      : {
          configPath: "C:\\ws\\seo.toml",
          platform: "windows",
          paths: { exportDir: "C:\\exports" },
          engine: { found: true, version: "0.11.0" },
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
            diagnostics: new DiagnosticsStore(),
          } as unknown as RootStore
        }
      >
        <MemoryRouter>
          <DiagnosticsPage />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>,
  );
}

describe("DiagnosticsPage", () => {
  it("renders the five platform tabs and one section per group", () => {
    const html = renderPage();
    expect(html).toContain("Platform diagnostics");
    expect(html).toContain("Read-only");
    expect(html).toContain("Google");
    expect(html).toContain("Yandex");
    expect(html).toContain("Bing");
    expect(html).toContain("Metrika");
    expect(html).toContain("Core Web Vitals");
    // One control per platform group is rendered even while its tab is hidden.
    expect(html).toContain("URL inspection");
    expect(html).toContain("Indexing history");
    expect(html).toContain("URL info");
    expect(html).toContain("Reporting window");
    expect(html).toContain("Lighthouse audits");
    expect(html).toContain("Inspect URL");
    expect(html).toContain("Recrawl queue");
    expect(html).toContain("Query/page joins");
    expect(html).toContain("Goals");
    expect(html).toContain("Run audits");
  });

  it("has no write action on the diagnostics page", () => {
    const html = renderPage();
    expect(html).not.toContain("allowWrite");
    expect(html).not.toContain("Confirm");
    expect(html).not.toContain("Apply");
  });

  it("explains an offline engine without hiding the tabs", () => {
    const html = renderPage(true);
    expect(html).toContain("Engine offline");
    expect(html).toContain("URL inspection");
  });

  it("keeps the read-only contract in every locale", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "diagnostics.readOnly").trim()).not.toBe("");
      expect(translate(locale, "diagnostics.title").trim()).not.toBe("");
    }
  });
});
