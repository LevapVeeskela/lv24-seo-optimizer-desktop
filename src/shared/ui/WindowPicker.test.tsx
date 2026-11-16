import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { WindowPicker } from "./WindowPicker";

function render(
  props: Partial<Parameters<typeof WindowPicker>[0]> = {},
): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <WindowPicker
        days={7}
        lagDays={2}
        period={{ start: "2026-11-08", end: "2026-11-14" }}
        onDaysChange={() => {}}
        onLagChange={() => {}}
        onReset={() => {}}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("WindowPicker", () => {
  it("marks the active preset and shows the resulting period", () => {
    const html = render();
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("7 days");
    expect(html).toContain("28 days");
    expect(html).toContain("90 days");
    expect(html).toContain("2026-11-08 – 2026-11-14");
    expect(html).toContain("Provider lag");
  });

  it("moves the pressed state when another preset is selected", () => {
    const html = render({ days: 28, lagDays: 3 });
    expect(html).toContain(
      'class="segment active" aria-pressed="true">28 days</button>',
    );
    expect(html).toContain('<option value="3" selected="">3 days</option>');
  });

  it("flags a window that the last run did not use yet", () => {
    const html = render({ stale: true });
    expect(html).toContain("Window changed; refresh to apply");
  });

  it("disables every control together", () => {
    const html = render({ disabled: true });
    expect(html.match(/disabled=""/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(html).toContain("<select");
  });
});
