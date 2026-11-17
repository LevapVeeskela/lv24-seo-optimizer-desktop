import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { RootStore } from "@/app/model/RootStore";
import { StoreProvider } from "@/app/providers/StoreProvider";
import { I18nProvider } from "@/shared/i18n";
import { IndexingStore } from "../model/IndexingStore";
import type { IndexingPlan } from "../model/types";
import { IndexingPanel } from "./IndexingPanel";

const CONFIG = "C:\\ws\\seo.toml";
const TOKEN = "1700000000:abcdef0123";

const PLAN: IndexingPlan = {
  status: "dry_run",
  action: "sitemap_submit",
  target: "https://example.com/",
  summary: "submit sitemap https://example.com/sitemap.xml to bing",
  planHash: "sha256-plan",
  confirmToken: TOKEN,
  ttlSeconds: 300,
  details: [{ key: "url", value: "https://example.com/sitemap.xml" }],
  limitations: ["Bing may take several days to recrawl."],
};

function renderPanel(
  store: IndexingStore,
  options: { offline?: boolean; configPath?: string | null } = {},
): string {
  const configPath =
    options.configPath === undefined ? CONFIG : options.configPath;
  const engine = {
    status: { configPath },
    loading: false,
    offline: options.offline ?? false,
    load: vi.fn(),
  };
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <StoreProvider
        store={
          {
            engine,
            indexing: store,
          } as unknown as RootStore
        }
      >
        <MemoryRouter>
          <IndexingPanel />
        </MemoryRouter>
      </StoreProvider>
    </I18nProvider>,
  );
}

describe("IndexingPanel", () => {
  it("renders both two-phase actions and the Site Scan explanation", () => {
    const html = renderPanel(new IndexingStore());
    expect(html).toContain("Bing indexing");
    expect(html).toContain("Bing sitemap submit");
    expect(html).toContain("Review plan");
    expect(html).toContain("Review IndexNow");
    expect(html).toContain("Plan → confirm");
    expect(html).toContain("No sitemap plan yet");
    expect(html).toContain("No IndexNow plan yet");
    expect(html).toContain("Engine default");
    expect(html).toContain("Bing has no public API");
    expect(html).toContain("Open Bing Site Scan");
    expect(html).toContain("Start the scan on the Bing page");
  });

  it("shows the reviewed plan and the explicit confirmation copy", () => {
    const store = new IndexingStore();
    store.sitemapState = "planned";
    store.sitemapPlan = PLAN;
    const html = renderPanel(store);
    expect(html).toContain("Sitemap plan");
    expect(html).toContain(PLAN.summary);
    expect(html).toContain("sha256-plan");
    expect(html).toContain("Submit sitemap");
    expect(html).toContain("Submit this sitemap to Bing?");
    expect(html).toContain("This sends a write request to Bing Webmaster");
    expect(html).toContain("The plan token is valid for 300 seconds");
    expect(html).toContain("Bing may take several days to recrawl.");
  });

  it("shows AUTH_REQUIRED with a Settings link instead of a success", () => {
    const store = new IndexingStore();
    store.sitemapState = "error";
    store.sitemapError = {
      code: "AUTH_REQUIRED",
      message: "Bing Webmaster API key is missing",
      nextAction: "add the key with `lv24-seo auth set --provider bing`",
      retryable: false,
    };
    const html = renderPanel(store);
    expect(html).toContain("Sitemap submit failed");
    expect(html).toContain("Bing needs an API key");
    expect(html).toContain('href="/settings"');
    expect(html).toContain("AUTH_REQUIRED");
    expect(html).not.toContain("Sitemap submission");
  });

  it("renders the sitemap result with its status", () => {
    const store = new IndexingStore();
    store.sitemapState = "applied";
    store.sitemapOutcome = {
      status: "applied",
      reason: null,
      plan: PLAN,
      details: [{ key: "submitted", value: "true" }],
      submitted: null,
    };
    const html = renderPanel(store);
    expect(html).toContain("Sitemap submission");
    expect(html).toContain("Applied");
    expect(html).toContain("Result details");
  });

  it("renders the IndexNow submitted count", () => {
    const store = new IndexingStore();
    store.indexNowState = "applied";
    store.indexNowOutcome = {
      status: "applied",
      reason: null,
      plan: { ...PLAN, action: "indexnow", target: "example.com" },
      details: [],
      submitted: 42,
    };
    const html = renderPanel(store);
    expect(html).toContain("IndexNow submission");
    expect(html).toContain("42 URL(s) submitted");
  });

  it("shows the opened Site Scan URL and never claims a scan started", () => {
    const store = new IndexingStore();
    store.setSiteUrl("https://example.com/");
    store.siteScanState = "opened";
    store.siteScanOpenedUrl =
      "https://www.bing.com/webmasters/sitescan?siteUrl=https%3A%2F%2Fexample.com%2F";
    const html = renderPanel(store);
    expect(html).toContain("Page opened");
    expect(html).toContain("the desktop did not start it");
    expect(html).toContain("bing.com/webmasters/sitescan");
  });

  it("asks for a workspace before either write action", () => {
    const html = renderPanel(new IndexingStore(), { configPath: null });
    expect(html).toContain("No workspace selected");
    expect(html).toContain("Open Settings");
  });

  it("keeps the Site Scan opener usable while the engine is offline", () => {
    const html = renderPanel(new IndexingStore(), { offline: true });
    expect(html).toContain("Engine offline");
    expect(html).toContain("Open Bing Site Scan");
  });
});
