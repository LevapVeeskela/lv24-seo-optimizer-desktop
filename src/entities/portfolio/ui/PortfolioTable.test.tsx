import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import type { PortfolioSite } from "../model/types";
import { PortfolioTable } from "./PortfolioTable";

const ROWS: PortfolioSite[] = [
  {
    configPath: "/srv/shop/seo.toml",
    name: "shop",
    property: "https://shop.example/",
    lastActivity: "2026-11-15T09:30:00Z",
    issues: { total: 5, critical: 2, all: 9 },
    error: null,
  },
  {
    configPath: "/srv/broken/seo.toml",
    name: "broken",
    property: null,
    lastActivity: null,
    issues: { total: null, critical: null, all: null },
    error: "seo.toml is not valid TOML",
  },
];

function render(activePath: string | null) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <PortfolioTable
        sites={ROWS}
        activePath={activePath}
        busyPath={null}
        onOpen={() => {}}
      />
    </I18nProvider>,
  );
}

describe("PortfolioTable", () => {
  it("renders one row per site with issues, activity and the open action", () => {
    const html = render("/srv/shop/seo.toml");
    expect(html).toContain("shop");
    expect(html).toContain("https://shop.example/");
    expect(html).toContain("2 critical");
    expect(html).toContain("9 stored in total");
    expect(html).toContain("Active");
    expect(html).toContain("Open workspace");
    expect(html).toContain("2026");
  });

  it("renders a per-site error in its own row instead of hiding the list", () => {
    const html = render(null);
    expect(html).toContain("broken");
    expect(html).toContain("seo.toml is not valid TOML");
    expect(html).toContain("No activity yet");
    expect(html).toContain("No property reported");
    expect(html).toContain("Not reported");
  });
});
