import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorBoundary, ErrorFallbackView } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("derives an Error from any thrown value", () => {
    expect(
      ErrorBoundary.getDerivedStateFromError(new Error("boom")).error?.message,
    ).toBe("boom");
    const fromString = ErrorBoundary.getDerivedStateFromError("boom").error;
    expect(fromString).toBeInstanceOf(Error);
    expect(fromString?.message).toBe("boom");
  });

  it("renders a reload action and the error message instead of an empty window", () => {
    const html = renderToStaticMarkup(
      <ErrorFallbackView
        message="Cannot read properties of null"
        title="This screen failed to render"
        hint="Reload the window."
        detailsLabel="Error details"
        reloadLabel="Reload window"
        onReload={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("This screen failed to render");
    expect(html).toContain("Reload window");
    expect(html).toContain("Cannot read properties of null");
    expect(html).toContain("Error details");
  });
});
