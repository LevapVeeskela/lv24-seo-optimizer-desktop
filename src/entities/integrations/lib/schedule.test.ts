import { describe, expect, it } from "vitest";
import {
  cronIssueKey,
  cronIssueParams,
  defaultScheduleTarget,
  formatScheduleArtifact,
  isScheduleTarget,
  scheduleView,
  validateCron,
  type ScheduleView,
} from "../index";

describe("cron validation", () => {
  it("accepts the five-field forms the engine renders", () => {
    for (const expression of [
      "0 6 * * 1",
      "*/15 9-18 * * mon-fri",
      "30 4 1,15 * 0",
      "0 0 * jan *",
      "5 0 * * 7",
    ]) {
      expect(validateCron(expression), expression).toEqual({ valid: true });
    }
  });

  it("rejects an empty expression or a wrong field count", () => {
    expect(validateCron("   ")).toEqual({
      valid: false,
      issue: { kind: "empty" },
    });
    expect(validateCron("0 6 * *")).toEqual({
      valid: false,
      issue: { kind: "fields", count: 4 },
    });
    expect(validateCron("0 6 * * 1 2026")).toEqual({
      valid: false,
      issue: { kind: "fields", count: 6 },
    });
  });

  it("points at the first invalid field", () => {
    expect(validateCron("60 6 * * 1")).toEqual({
      valid: false,
      issue: { kind: "field", field: 1 },
    });
    expect(validateCron("0 24 * * 1")).toEqual({
      valid: false,
      issue: { kind: "field", field: 2 },
    });
    expect(validateCron("0 6 * * 8")).toEqual({
      valid: false,
      issue: { kind: "field", field: 5 },
    });
    expect(validateCron("0 6 * * 1/0")).toEqual({
      valid: false,
      issue: { kind: "field", field: 5 },
    });
    expect(validateCron("0 6 * * 1,,2")).toEqual({
      valid: false,
      issue: { kind: "field", field: 5 },
    });
    expect(validateCron("0 6 * * ?")).toEqual({
      valid: false,
      issue: { kind: "field", field: 5 },
    });
  });

  it("maps issues to localized message keys", () => {
    expect(cronIssueKey({ kind: "empty" })).toBe(
      "integrations.schedule.cronEmpty",
    );
    expect(cronIssueKey({ kind: "fields", count: 4 })).toBe(
      "integrations.schedule.cronFields",
    );
    expect(cronIssueKey({ kind: "field", field: 3 })).toBe(
      "integrations.schedule.cronField",
    );
    expect(cronIssueParams({ kind: "empty" })).toBeUndefined();
    expect(cronIssueParams({ kind: "fields", count: 4 })).toEqual({ count: 4 });
    expect(cronIssueParams({ kind: "field", field: 3 })).toEqual({ field: 3 });
  });
});

describe("schedule targets", () => {
  it("resolves the host platform and falls back to cron", () => {
    expect(defaultScheduleTarget("windows")).toBe("windows");
    expect(defaultScheduleTarget("win32")).toBe("windows");
    expect(defaultScheduleTarget("linux")).toBe("systemd");
    expect(defaultScheduleTarget("macos")).toBe("cron");
    expect(defaultScheduleTarget("darwin")).toBe("cron");
    expect(defaultScheduleTarget(null)).toBe("cron");
    expect(defaultScheduleTarget("freebsd")).toBe("cron");
  });

  it("only accepts the three targets the engine renders", () => {
    expect(isScheduleTarget("cron")).toBe(true);
    expect(isScheduleTarget("systemd")).toBe(true);
    expect(isScheduleTarget("windows")).toBe(true);
    expect(isScheduleTarget("auto")).toBe(false);
    expect(isScheduleTarget("Windows")).toBe(false);
    expect(isScheduleTarget(null)).toBe(false);
  });
});

describe("schedule artifact", () => {
  const artifact: ScheduleView = {
    target: "cron",
    dryRun: true,
    command: "crontab -",
    files: [
      {
        name: "lv24-seo-weekly.cron",
        content:
          "# lv24-seo weekly SEO report\nCRON_TZ=Europe/Minsk\n0 6 * * 1 lv24-seo report weekly --json\n",
      },
    ],
    warnings: ["cron runs in host time"],
  };

  it("normalizes a raw engine payload and drops unusable entries", () => {
    expect(
      scheduleView({
        target: "systemd",
        dry_run: false,
        command: "systemctl --user daemon-reload",
        files: {
          "lv24-seo-weekly.service": "[Unit]\n",
          "lv24-seo-weekly.timer": 42,
        },
        warnings: ["one", "", 7],
      }),
    ).toEqual({
      target: "systemd",
      dryRun: false,
      command: "systemctl --user daemon-reload",
      files: [{ name: "lv24-seo-weekly.service", content: "[Unit]\n" }],
      warnings: ["one"],
    });
  });

  it("renders an empty artifact instead of throwing on an unknown payload", () => {
    expect(scheduleView(null)).toEqual({
      target: null,
      dryRun: false,
      command: null,
      files: [],
      warnings: [],
    });
  });

  it("builds the copy-all payload from the command and files", () => {
    expect(formatScheduleArtifact(artifact)).toBe(
      [
        "target: cron",
        "dry_run: yes",
        "command: crontab -",
        "lv24-seo-weekly.cron:",
        "# lv24-seo weekly SEO report",
        "CRON_TZ=Europe/Minsk",
        "0 6 * * 1 lv24-seo report weekly --json",
      ].join("\n"),
    );
  });

  it("keeps the per-file copy payload byte-for-byte", () => {
    expect(artifact.files[0].content).toContain("0 6 * * 1 lv24-seo report");
    expect(artifact.files[0].content.endsWith("\n")).toBe(true);
  });

  it("drops one trailing CRLF without touching the file body", () => {
    expect(
      formatScheduleArtifact({
        ...artifact,
        files: [{ name: "job.xml", content: "<Task>\r\n</Task>\r\n" }],
      }),
    ).toBe("target: cron\ndry_run: yes\ncommand: crontab -\njob.xml:\n<Task>\r\n</Task>");
  });
});
