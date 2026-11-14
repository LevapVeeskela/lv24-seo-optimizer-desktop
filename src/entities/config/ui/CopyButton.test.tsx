import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { CopyButton, copyButtonLabel } from "./CopyButton";

describe("CopyButton", () => {
  it("renders the idle label without an error before any click", () => {
    const html = renderToStaticMarkup(
      <I18nProvider locale="en" onLocaleChange={() => {}}>
        <CopyButton value="x" label="Copy" copiedLabel="Copied" />
      </I18nProvider>,
    );
    expect(html).toContain("Copy");
    expect(html).not.toContain('role="alert"');
  });

  it("shows the failure label instead of a tooltip-only hint", () => {
    expect(
      copyButtonLabel({
        copied: false,
        failed: true,
        label: "Copy",
        copiedLabel: "Copied",
        failedLabel: "Clipboard is unavailable.",
      }),
    ).toBe("Clipboard is unavailable.");
  });

  it("prefers a transient copied label while the copy succeeds", () => {
    expect(
      copyButtonLabel({
        copied: true,
        failed: false,
        label: "Copy",
        copiedLabel: "Copied",
        failedLabel: "Clipboard is unavailable.",
      }),
    ).toBe("Copied");
  });
});
