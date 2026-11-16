import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsSectionNav } from "./SettingsSectionNav";

describe("SettingsSectionNav", () => {
  it("renders one jump control per section with change badges", () => {
    const html = renderToStaticMarkup(
      <SettingsSectionNav
        label="Settings sections"
        items={[
          { id: "settings-section-project", label: "Project", changedCount: 2 },
          { id: "settings-section-crawl", label: "Crawl", changedCount: 0 },
        ]}
        jumpLabel={(section) => `Jump to ${section}`}
        onJump={() => {}}
      />,
    );

    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('aria-label="Jump to Project"');
    expect(html).toContain('aria-label="Jump to Crawl"');
    expect(html).toContain("Project");
    expect(html).toContain("Crawl");
    expect(html).toContain(">2</span>");
    expect(html).not.toContain(">0</span>");
  });
});
