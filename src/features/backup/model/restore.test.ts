import { describe, expect, it } from "vitest";
import {
  normalizeRestoreOutcome,
  normalizeRestorePlan,
  restoreDetails,
} from "./restore";

describe("restore plan normalization", () => {
  it("reads the snake_case plan envelope the engine returns", () => {
    const plan = normalizeRestorePlan({
      status: "dry_run",
      plan: {
        action: "backup_restore",
        target: "C:\\ws\\seo.toml",
        summary: "restore 1 file",
        payload: { archive: "a.zip", overwrite: true },
        limitations: ["secrets.json is not restored", "secrets.json is not restored"],
      },
      plan_hash: "sha256:plan",
      confirm_token: "1700000000:abcdef",
      ttl_seconds: 300,
      limitations: ["database is replaced"],
    });

    expect(plan).toMatchObject({
      status: "dry_run",
      action: "backup_restore",
      target: "C:\\ws\\seo.toml",
      summary: "restore 1 file",
      planHash: "sha256:plan",
      confirmToken: "1700000000:abcdef",
      ttlSeconds: 300,
    });
    expect(plan.details).toEqual([
      { key: "archive", value: "a.zip" },
      { key: "overwrite", value: "true" },
    ]);
    expect(plan.limitations).toEqual([
      "database is replaced",
      "secrets.json is not restored",
    ]);
  });

  it("accepts camelCase fields from a newer transport", () => {
    const plan = normalizeRestorePlan({
      plan: { action: "backup_restore", target: "C:\\ws" },
      planHash: "sha256:camel",
      confirmToken: "1700000000:camel",
      ttlSeconds: 120,
    });
    expect(plan.planHash).toBe("sha256:camel");
    expect(plan.confirmToken).toBe("1700000000:camel");
    expect(plan.ttlSeconds).toBe(120);
  });

  it("renders an empty plan instead of throwing on unexpected data", () => {
    expect(normalizeRestorePlan(null)).toEqual({
      status: null,
      action: null,
      target: null,
      summary: null,
      planHash: null,
      confirmToken: null,
      ttlSeconds: null,
      details: [],
      limitations: [],
    });
  });

  it("bounds long nested detail values", () => {
    const [detail] = restoreDetails({ blob: { nested: "x".repeat(600) } });
    expect(detail.key).toBe("blob");
    expect(detail.value.length).toBeLessThanOrEqual(401);
    expect(detail.value.endsWith("…")).toBe(true);
  });
});

describe("restore outcome normalization", () => {
  it("falls back to the reviewed plan when the apply echo is partial", () => {
    const reviewed = normalizeRestorePlan({
      plan: {
        action: "backup_restore",
        target: "C:\\ws\\seo.toml",
        summary: "restore 2 files",
        payload: { archive: "a.zip" },
      },
      plan_hash: "sha256:plan",
      confirm_token: "1700000000:abcdef",
      ttl_seconds: 300,
    });

    const outcome = normalizeRestoreOutcome(
      { status: "applied", result: { restored: 2 } },
      reviewed,
    );

    expect(outcome.status).toBe("applied");
    expect(outcome.plan.summary).toBe("restore 2 files");
    expect(outcome.plan.planHash).toBe("sha256:plan");
    expect(outcome.plan.details).toEqual([{ key: "archive", value: "a.zip" }]);
    expect(outcome.details).toEqual([{ key: "restored", value: "2" }]);
  });

  it("keeps an unknown status explicit", () => {
    const outcome = normalizeRestoreOutcome({ status: "queued" }, null);
    expect(outcome.status).toBe("unknown");
    expect(outcome.reason).toBeNull();
    expect(outcome.plan.action).toBeNull();
  });
});
