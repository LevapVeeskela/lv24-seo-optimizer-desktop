import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { RootStore } from "@/app/model/RootStore";
import { DiscardGuardProvider } from "@/app/providers/DiscardGuard";
import { StoreProvider } from "@/app/providers/StoreProvider";
import { NAV_ITEMS } from "@/app/layout/AppNav";
import { ROUTES } from "@/app/routes";
import { I18nProvider, LOCALES, translate } from "@/shared/i18n";
import { FeedbackProvider } from "@/shared/ui/Feedback";
import { PortfolioPage } from "./PortfolioPage";

function renderPage() {
  const store = new RootStore();
  const html = renderToStaticMarkup(
    <StoreProvider store={store}>
      <I18nProvider locale="en" onLocaleChange={() => {}}>
        <FeedbackProvider>
          <DiscardGuardProvider>
            <MemoryRouter initialEntries={["/portfolio"]}>
              <PortfolioPage />
            </MemoryRouter>
          </DiscardGuardProvider>
        </FeedbackProvider>
      </I18nProvider>
    </StoreProvider>,
  );
  store.dispose();
  return html;
}

describe("portfolio route and navigation", () => {
  it("declares the /portfolio route once in the primary navigation", () => {
    expect(ROUTES.portfolio).toBe("/portfolio");
    const entries = NAV_ITEMS.filter((item) => item.to === ROUTES.portfolio);
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe("nav.portfolio");
  });

  it("has a translated portfolio nav label in every locale", () => {
    for (const locale of LOCALES) {
      expect(translate(locale, "nav.portfolio").trim()).not.toBe("");
    }
    expect(translate("en", "nav.portfolio")).not.toBe(
      translate("ru", "nav.portfolio"),
    );
    expect(translate("en", "nav.portfolio")).not.toBe(
      translate("zh", "nav.portfolio"),
    );
  });
});

describe("PortfolioPage", () => {
  it("renders the root picker and the no-root empty state", () => {
    const html = renderPage();
    expect(html).toContain("Portfolio");
    expect(html).toContain("Portfolio folder");
    expect(html).toContain("Choose folder");
    expect(html).toContain("Choose a portfolio folder");
    expect(html).toContain("Pick the folder that contains your projects");
  });

  it("does not claim a scan result before a root is chosen", () => {
    const html = renderPage();
    expect(html).not.toContain("Portfolio summary");
    expect(html).not.toContain("No projects found");
  });
});
