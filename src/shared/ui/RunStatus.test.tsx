import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { RunStatus } from "./RunStatus";
import {
  buildRunSummary,
  durationFromMeta,
  formatDuration,
} from "./RunStatusModel";

const FINISHED = Date.UTC(2026, 10, 16, 9, 30);

function render(
  props: Partial<Parameters<typeof RunStatus>[0]> = {},
): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <RunStatus
        label="Provider stats"
        running={false}
        startedAt={null}
        lastRun={null}
        {...props}
      />
    </I18nProvider>,
  );
}

describe("formatDuration", () => {
  it("formats milliseconds, seconds, minutes and hours", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(850)).toBe("850 ms");
    expect(formatDuration(1500)).toBe("1.5 s");
    expect(formatDuration(74_000)).toBe("1 min 14 s");
    expect(formatDuration(3_725_000)).toBe("1 h 02 min");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("buildRunSummary", () => {
  it("prefers meta.duration_ms over wall time", () => {
    expect(durationFromMeta({ duration_ms: 4200 })).toBe(4200);
    expect(durationFromMeta({ duration_ms: "4200" })).toBeNull();
    expect(durationFromMeta({ duration_ms: -1 })).toBeNull();
    expect(durationFromMeta({})).toBeNull();

    const summary = buildRunSummary({
      startedAt: 1000,
      finishedAt: 9000,
      meta: { duration_ms: 4200 },
      ok: true,
      truncated: false,
      limitations: [],
    });
    expect(summary.durationMs).toBe(4200);
    expect(summary.durationSource).toBe("engine");
  });

  it("deduplicates limitations and trims blanks", () => {
    const summary = buildRunSummary({
      startedAt: 1000,
      finishedAt: 2000,
      meta: {},
      ok: true,
      truncated: true,
      limitations: ["GSC lag", " ", "GSC lag", "no Bing rows"],
    });
    expect(summary.durationMs).toBe(1000);
    expect(summary.durationSource).toBe("measured");
    expect(summary.limitations).toEqual(["GSC lag", "no Bing rows"]);
  });
});

describe("RunStatus", () => {
  it("renders nothing before the first run", () => {
    expect(render()).toBe("");
  });

  it("shows the last run duration, truncation and limitations", () => {
    const html = render({
      lastRun: {
        startedAt: FINISHED - 3400,
        finishedAt: FINISHED,
        durationMs: 3400,
        durationSource: "engine",
        ok: true,
        truncated: true,
        limitations: ["GSC lag", "no Bing rows"],
      },
    });
    expect(html).toContain("Last run 3.4 s");
    expect(html).toContain("Truncated");
    expect(html).toContain("2 limitations");
    expect(html).not.toContain("measured by the app");
  });

  it("marks a measured duration and a failed run honestly", () => {
    const html = render({
      lastRun: {
        startedAt: FINISHED - 7000,
        finishedAt: FINISHED,
        durationMs: 7000,
        durationSource: "measured",
        ok: false,
        truncated: false,
        limitations: [],
      },
    });
    expect(html).toContain("Last run 7.0 s");
    expect(html).toContain("Run failed");
    expect(html).toContain("measured by the app");
    expect(html).toContain("Not truncated");
  });

  it("shows elapsed time and states that the call runs to completion", () => {
    const html = render({
      running: true,
      startedAt: Date.now() - 3000,
    });
    expect(html).toContain("Running for");
    expect(html).toContain("runs this call to completion");
    expect(html).toContain("no cancel button");
    expect(html).not.toContain("Last run");
  });
});
