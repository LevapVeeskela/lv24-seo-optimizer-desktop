import { describe, expect, it } from "vitest";
import type { ReportSection, WeeklyReport } from "@/entities/report/model/types";
import type { StatsData } from "@/entities/stats/model/types";
import { translate, type MessageKey } from "@/shared/i18n";
import { buildRecommendations } from "../lib/buildRecommendations";
import { recommendationTaskText } from "./copy";

const PERIOD = { start: "2026-11-01", end: "2026-11-07" };

function report(sections: ReportSection[]): WeeklyReport {
  return {
    kind: "weekly",
    property_id: "sc-domain:example.com",
    period: PERIOD,
    generated_at: "2026-11-08T08:00:00+00:00",
    headline: "Test headline",
    sections,
    limitations: [],
  };
}

const providerLabel = (id: string): string =>
  translate("ru", `recommendations.provider.${id}` as MessageKey);

describe("recommendationTaskText", () => {
  it("renders the task title in the active locale with query params", () => {
    const [decay] = buildRecommendations(
      report([
        {
          key: "opportunities",
          title: "Opportunities",
          summary: "",
          rows: [
            {
              kind: "decay",
              query: "rank tracker",
              page: "https://example.com/tools/rank",
              expected_clicks: 18,
              evidence: { previous_clicks: 20, clicks: 2 },
            },
          ],
          notes: [],
        },
      ]),
      null,
    );

    const title = recommendationTaskText(
      decay,
      "title",
      (key, params) => translate("ru", key, params),
      providerLabel,
    );
    expect(title).toContain("rank tracker");
    expect(title).toContain("клики");
    expect(title).not.toContain("Recover lost clicks");

    const verification = recommendationTaskText(
      decay,
      "verification",
      (key, params) => translate("zh", key, params),
      providerLabel,
    );
    expect(verification).toContain("周报");
  });

  it("resolves the provider label in the active locale", () => {
    const stats: StatsData = {
      services: [
        {
          provider: "yandex_webmaster",
          configured: true,
          ready: false,
          status: "missing_token",
          rows: 0,
        },
      ],
    };
    const [task] = buildRecommendations(null, stats);

    const title = recommendationTaskText(
      task,
      "title",
      (key, params) => translate("ru", key, params),
      providerLabel,
    );
    expect(title).toContain("Яндекс Вебмастер");
    expect(title).not.toContain("{label}");
    expect(title).not.toContain("Connect");
  });

  it("falls back to the stored English text for older queued tasks", () => {
    const legacy = {
      id: "crawl:crawl:legacy-00000000",
      category: "crawl" as const,
      severity: "low" as const,
      source: "crawl",
      title: "Legacy title",
      action: "Legacy action",
      verification: "Legacy verification",
      evidence: [],
    };

    expect(
      recommendationTaskText(
        legacy,
        "title",
        (key, params) => translate("ru", key, params),
        providerLabel,
      ),
    ).toBe("Legacy title");
  });
});
