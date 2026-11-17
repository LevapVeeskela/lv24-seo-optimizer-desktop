import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", () => ({
  runIndexingStatus: vi.fn(),
  runIndexingHistory: vi.fn(),
  runScheduleStatus: vi.fn(),
}));

import type { Envelope } from "@/shared/cli";
import { I18nProvider } from "@/shared/i18n";
import {
  runIndexingHistory,
  runIndexingStatus,
  runScheduleStatus,
} from "../lib/ipc";
import { IndexingStatusStore } from "../model/IndexingStatusStore";
import { IndexingAutomationCard } from "./IndexingAutomationCard";

const CONFIG = "C:\\ws\\seo.toml";

function ok<T>(data: T, meta: Record<string, unknown> = {}): Envelope<T> {
  return { ok: true, data, meta, warnings: [] };
}

function failure(
  code: string,
  message: string,
  nextAction?: string,
): Envelope<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(nextAction ? { next_action: nextAction } : {}),
      retryable: false,
    },
    meta: {},
    warnings: [],
  };
}

function provider(
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    provider: name,
    property_id: `property-${name}`,
    urls: 0,
    submitted: 0,
    inspected: 0,
    indexed: 0,
    not_indexed: 0,
    crawled: 0,
    unknown: 0,
    queued: 0,
    stale: 0,
    pending: 0,
    indexed_total: null,
    indexed_total_source: null,
    quota: null,
    limitations: [],
    rows: [],
    data_age_days: 0,
    ...overrides,
  };
}

function statusData(): Record<string, unknown> {
  return {
    providers: {
      bing: provider("bing", {
        property_id: "https://lv24.by",
        urls: 120,
        submitted: 80,
        pending: 40,
        quota: {
          source: "provider",
          remaining: 90,
          daily_remaining: 90,
          monthly_remaining: 1200,
          used: null,
          limit: null,
          reset: null,
        },
        limitations: ["no_per_url_index_count"],
        data_age_days: 1,
      }),
      gsc: provider("gsc", {
        property_id: "sc-domain:lv24.by",
        urls: 30,
        submitted: 30,
        pending: 5,
        indexed: 12,
        indexed_total: 120,
        indexed_total_source: "gsc_sitemaps_contents",
        quota: {
          source: "local",
          remaining: 43,
          used: 7,
          limit: 50,
          daily_remaining: null,
          monthly_remaining: null,
          reset: "2026-11-19T00:00:00Z",
        },
        limitations: ["gsc_indexed_count_deprecated"],
        data_age_days: 2,
      }),
      yandex: provider("yandex", {
        limitations: ["provider_not_configured"],
      }),
    },
    write_secret_present: true,
    limitations: ["no_per_url_index_count", "gsc_indexed_count_deprecated"],
  };
}

const STATUS_META = {
  total: 150,
  truncated: true,
  data_age_days: 2,
  limitations: ["history_limit"],
  live: true,
};

function historyData(): Record<string, unknown> {
  const errorItems = Array.from({ length: 6 }, (_, index) => ({
    url: `https://lv24.by/e${index + 1}`,
    code: "HTTP_429",
    message: "provider quota",
  }));
  return {
    runs: [
      {
        started_at: "2026-11-18T04:00:00Z",
        finished_at: "2026-11-18T04:02:00Z",
        provider: "bing",
        status: "ok",
        planned: 50,
        submitted: 40,
        checked: 10,
        skipped: 1,
        detail: { errors: 6, error_items: errorItems },
      },
      {
        started_at: "2026-11-17T04:00:00Z",
        finished_at: "2026-11-17T04:01:00Z",
        provider: "gsc",
        status: "partial",
        planned: 5,
        submitted: 5,
        checked: 3,
        skipped: 0,
        detail: { errors: 0, error_items: [] },
      },
    ],
  };
}

function scheduleData(state: string): Record<string, unknown> {
  return {
    state,
    name: "lv24-seo-indexing",
    target: "windows",
    warnings: [],
  };
}

function render(store: IndexingStatusStore, offline = false): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <MemoryRouter>
        <IndexingAutomationCard
          store={store}
          configPath={CONFIG}
          offline={offline}
          loading={false}
          platform="windows"
        />
      </MemoryRouter>
    </I18nProvider>,
  );
}

function mockReady(scheduleState = "installed"): void {
  vi.mocked(runIndexingStatus).mockResolvedValue(
    ok(statusData(), STATUS_META),
  );
  vi.mocked(runIndexingHistory).mockResolvedValue(
    ok(historyData(), { total: 2, truncated: false, limitations: [] }),
  );
  vi.mocked(runScheduleStatus).mockResolvedValue(ok(scheduleData(scheduleState)));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReady();
});

describe("IndexingAutomationCard", () => {
  it("renders provider quotas, the deprecated aggregate and the run history", async () => {
    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    const html = render(store);

    expect(html).toContain("Indexing automation");
    expect(html).toContain("Scheduled");
    expect(html).toContain("Daily 04:00");
    expect(html).toContain("Read-only");

    expect(html).toContain("Bing");
    expect(html).toContain("Yandex Webmaster");
    expect(html).toContain("Google Search Console");
    expect(html).toContain("IndexNow");
    expect(html).toContain("Daily remaining: 90");
    expect(html).toContain("Monthly remaining: 1,200");
    expect(html).toContain("Used 7 / 50");
    expect(html).toContain("No data yet");
    expect(html).toContain("Not configured or missing credentials");

    expect(html).toContain("Indexed total: 120");
    expect(html).toContain("deprecated GSC sitemap aggregate");
    expect(html).toContain("truncated the URL list");

    expect(html).toContain("Last run");
    expect(html).toContain("HTTP_429");
    expect(html).toContain("https://lv24.by/e1");
    // Only five error rows are shown; the sixth is summarized.
    expect(html).not.toContain("https://lv24.by/e6");
    expect(html).toContain("1 more error(s) not shown.");

    expect(html).toContain("Run history");
    expect(html).toContain("2026-11-18");
    expect(html).toContain("2026-11-17");
    expect(html).toContain("Last 7 days: 2 runs, 45 submitted, 13 checked.");
    expect(html).toContain("Last 30 days: 2 runs, 45 submitted, 13 checked.");

    expect(html).toContain("Data age: 2 d");
    expect(html).toContain("history_limit");
    expect(html).toContain("no_per_url_index_count");
    expect(html).toContain("gsc_indexed_count_deprecated");
  });

  it("shows Scheduled for installed and the state otherwise", async () => {
    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    expect(render(store)).toContain("Scheduled");

    mockReady("missing");
    await store.load(CONFIG, "windows");
    const missing = render(store);
    expect(missing).toContain("Not installed");
    expect(missing).not.toContain("Scheduled");
  });

  it("renders an explicit empty state when no provider is configured", async () => {
    vi.mocked(runIndexingStatus).mockResolvedValue(
      ok(
        {
          providers: {
            bing: provider("bing", {
              limitations: ["provider_not_configured"],
            }),
            yandex: provider("yandex", {
              limitations: ["provider_not_configured"],
            }),
            gsc: provider("gsc", {
              limitations: ["provider_not_configured"],
            }),
            indexnow: provider("indexnow", {
              limitations: ["provider_not_configured"],
            }),
          },
          limitations: ["provider_not_configured"],
        },
        { data_age_days: 0, limitations: ["provider_not_configured"] },
      ),
    );
    vi.mocked(runIndexingHistory).mockResolvedValue(ok({ runs: [] }));

    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    const html = render(store);

    expect(html).toContain("No indexing data yet");
    expect(html).not.toContain("Daily remaining");
    expect(html).not.toContain("Run history");
    expect(html).toContain("provider_not_configured");
  });

  it("explains an old engine and hides the tables", async () => {
    vi.mocked(runIndexingStatus).mockResolvedValue(
      failure("INVALID_COMMAND", "command indexing_status is not in the allow-list"),
    );
    vi.mocked(runIndexingHistory).mockResolvedValue(
      failure("INVALID_COMMAND", "command indexing_history is not in the allow-list"),
    );
    vi.mocked(runScheduleStatus).mockResolvedValue(
      failure("INVALID_COMMAND", "command schedule_status is not in the allow-list"),
    );

    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    const html = render(store);

    expect(html).toContain("needs engine &gt;= 0.13.1");
    expect(html).not.toContain("Daily remaining");
    expect(html).not.toContain("Run history");
    expect(html).not.toContain("Indexing status failed");
  });

  it("shows the engine next_action instead of a generic failure", async () => {
    vi.mocked(runIndexingStatus).mockResolvedValue(
      failure(
        "UPSTREAM_UNAVAILABLE",
        "the indexing queue could not be read",
        "check provider credentials and retry",
      ),
    );

    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    const html = render(store);

    expect(html).toContain("Indexing status failed");
    expect(html).toContain("the indexing queue could not be read");
    expect(html).toContain("Next action:");
    expect(html).toContain("check provider credentials and retry");
    expect(html).toContain("Error code: UPSTREAM_UNAVAILABLE");
  });

  it("disables refresh while loading", () => {
    const store = new IndexingStatusStore();
    store.state = "loading";

    const html = render(store);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("disabled");
  });

  it("keeps tokens, secrets and write controls out of the DOM", async () => {
    const store = new IndexingStatusStore();
    await store.load(CONFIG, "windows");
    const html = render(store).toLowerCase();

    expect(html).not.toContain("confirm");
    expect(html).not.toContain("allow-write");
    expect(html).not.toContain("lv24_seo_write_secret");
    expect(html).not.toContain("token");
    expect(html).not.toContain("secret");
  });
});
