import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { SaveConfigBar } from "./SaveConfigBar";

function render(overrides: Partial<Parameters<typeof SaveConfigBar>[0]> = {}) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <SaveConfigBar
        dirty
        saving={false}
        validating={false}
        canSave
        changedCount={3}
        errorCount={0}
        warningCount={0}
        lastBackup={null}
        onSave={() => {}}
        onDiscard={() => {}}
        onValidate={() => {}}
        {...overrides}
      />
    </I18nProvider>,
  );
}

describe("SaveConfigBar", () => {
  it("docks to the viewport bottom so save stays reachable", () => {
    const html = render();
    expect(html).toContain('data-sticky="true"');
    expect(html).toContain("position:sticky");
    expect(html).toContain("bottom:0");
  });

  it("announces the draft state and the changed field count", () => {
    const html = render();
    expect(html).toContain("Unsaved changes");
    expect(html).toContain("3 changed");
    expect(html).toContain("Ctrl/Cmd+S saves");
  });

  it("advertises the command shortcut on the save button", () => {
    const html = render();
    expect(html).toContain('aria-keyshortcuts="Control+S Meta+S"');
    expect(html).toContain(">Save</button>");
  });

  it("keeps save disabled while there is nothing to save", () => {
    const html = render({ dirty: false, canSave: false, changedCount: 0 });
    expect(html).toContain("Saved");
    expect(html).not.toContain("3 changed");
    expect(html).toContain('disabled=""');
  });
});
