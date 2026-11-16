import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { WorkspaceChipView, type WorkspaceChipViewProps } from "./WorkspaceChip";

const RECENTS = [
  {
    path: "C:\\work\\alpha\\seo.toml",
    label: "alpha",
    site: "https://alpha.test",
    openedAt: "2026-11-16T08:00:00Z",
  },
  {
    path: "C:\\work\\beta\\seo.toml",
    label: "beta",
    site: null,
    openedAt: "2026-11-15T08:00:00Z",
  },
];

function render(props: Partial<WorkspaceChipViewProps> = {}) {
  const defaults: WorkspaceChipViewProps = {
    site: "alpha.test",
    label: "alpha",
    configPath: "C:\\work\\alpha\\seo.toml",
    recents: RECENTS,
    activePath: "C:\\work\\alpha\\seo.toml",
    busyPath: null,
    open: false,
    onToggle: () => undefined,
    onActivate: () => undefined,
    onClear: () => undefined,
    onChoose: () => undefined,
    onCreate: () => undefined,
  };
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => undefined}>
      <WorkspaceChipView {...defaults} {...props} />
    </I18nProvider>,
  );
}

describe("WorkspaceChip", () => {
  it("shows the active site and config path without opening the menu", () => {
    const html = render();
    expect(html).toContain("alpha.test");
    expect(html).toContain("C:\\work\\alpha\\seo.toml");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="group"');
  });

  it("falls back to the workspace label when no site is known", () => {
    const html = render({ site: null, label: "alpha" });
    expect(html).toContain("alpha");
    expect(html).toContain('title="C:\\work\\alpha\\seo.toml"');
  });

  it("lists recent workspaces with the active one marked", () => {
    const html = render({ open: true });
    expect(html).toContain('role="group"');
    expect(html).toContain("Recent workspaces");
    expect(html).toContain('aria-current="true"');
    expect(html).toContain("alpha · Active");
    expect(html).toContain("beta");
    expect(html).toContain("Clear list");
    expect(html).toContain("New project");
  });

  it("shows the empty state and hides the clear action without entries", () => {
    const html = render({ open: true, recents: [] });
    expect(html).toContain("No recent workspaces yet.");
    expect(html).not.toContain("Clear list");
  });

  it("announces the workspace that is being opened", () => {
    const html = render({ open: true, busyPath: "C:\\work\\beta\\seo.toml" });
    expect(html).toContain("Opening…");
    expect(html).toContain('disabled=""');
  });
});
