import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { RunStore } from "../model/RunStore";
import { RunBanner } from "./RunBanner";

function makeStore(): RunStore {
  let nextId = 0;
  let tick = 1_000;
  return new RunStore({
    cancel: async () => true,
    newId: () => `run-${++nextId}`,
    now: () => (tick += 1_000),
  });
}

function render(store: RunStore): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <RunBanner runs={store} />
    </I18nProvider>,
  );
}

describe("RunBanner", () => {
  it("renders nothing when no run is active or cancelled", () => {
    expect(render(makeStore())).toBe("");
  });

  it("shows the run kind, elapsed time and a Cancel button", () => {
    const store = makeStore();
    store.start("crawl");

    const html = render(store);
    expect(html).toContain("Crawl");
    expect(html).toContain("Running for");
    expect(html).toContain("Cancel Crawl");
    expect(html).toContain("run-banner-running");
  });

  it("shows a distinct cancelled state without a Cancel button", () => {
    const store = makeStore();
    const entry = store.start("reportWeekly");
    store.settle(entry, {
      ok: false,
      error: { code: "RUN_CANCELLED", message: "cancelled", retryable: false },
      meta: {},
      warnings: [],
    });

    const html = render(store);
    expect(html).toContain("Weekly report");
    expect(html).toContain("Cancelled. Files already written are kept.");
    expect(html).toContain("run-banner-cancelled");
    expect(html).not.toContain("Cancel Weekly report");
    expect(html).toContain("Dismiss");
  });

  it("keeps the banner across a route change", () => {
    const store = makeStore();
    store.start("logsAnalyze");

    // A route change unmounts the page and renders another one; the shared
    // store is untouched, so the banner still carries the Cancel button.
    const first = render(store);
    const second = render(store);
    expect(first).toContain("Cancel Log analysis");
    expect(second).toContain("Cancel Log analysis");
    expect(store.activeCount).toBe(1);
  });

  it("shows one row per active run", () => {
    const store = makeStore();
    store.start("crawl");
    store.start("backupCreate");

    const html = render(store);
    expect(html).toContain("Cancel Crawl");
    expect(html).toContain("Cancel Backup");
    expect(html.match(/run-banner-running/g) ?? []).toHaveLength(2);
  });
});
