import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { BackupStore } from "./BackupStore";

const CONFIG = "C:\\ws\\seo.toml";
const ARCHIVE = "C:\\backups\\lv24-seo-backup-20261116T101500Z.zip";

const PLAN = {
  status: "dry_run",
  plan: {
    action: "backup_restore",
    target: CONFIG,
    summary: "restore 2 files into C:\\ws",
    payload: {
      archive: ARCHIVE,
      database: true,
      files: ["seo.toml", "data/seo.sqlite3"],
    },
    limitations: ["secrets.json is not restored"],
  },
  plan_hash: "sha256:plan",
  confirm_token: "1700000000:abcdef0123",
  ttl_seconds: 300,
};

const APPLIED = {
  status: "applied",
  plan: PLAN.plan,
  plan_hash: "sha256:plan",
  result: { restored: 2, target_dir: "C:\\ws" },
};

function success(data: unknown, warnings: string[] = []): Envelope<unknown> {
  return { ok: true, data, meta: {}, warnings };
}

function store(restore: ReturnType<typeof vi.fn>) {
  return new BackupStore(
    vi.fn() as unknown as typeof import("../lib/ipc").runBackupCreate,
    () => new Date("2026-11-16T10:00:00Z"),
    restore as unknown as typeof import("../lib/ipc").runBackupRestore,
  );
}

describe("BackupStore restore", () => {
  it("plans without the write opt-in or a token", async () => {
    const restore = vi.fn(async () => success(PLAN, ["ledger ready"]));
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);

    expect(await backup.planRestore(CONFIG)).toBe(true);

    expect(restore).toHaveBeenCalledWith({
      file: ARCHIVE,
      configPath: CONFIG,
      allowWrite: false,
      confirm: null,
    });
    expect(backup.restoreState).toBe("planned");
    expect(backup.restorePlan?.confirmToken).toBe("1700000000:abcdef0123");
    expect(backup.restorePlan?.ttlSeconds).toBe(300);
    expect(backup.restorePlan?.details.map((item) => item.key)).toEqual([
      "archive",
      "database",
      "files",
    ]);
    expect(backup.restorePlan?.limitations).toEqual([
      "secrets.json is not restored",
    ]);
    expect(backup.restoreWarnings).toEqual(["ledger ready"]);
    expect(backup.restoreReady).toBe(true);
  });

  it("refuses to apply until the confirmation was requested", async () => {
    const restore = vi.fn(async () => success(PLAN));
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);
    await backup.planRestore(CONFIG);

    expect(await backup.confirmRestore(CONFIG)).toBe(false);

    expect(restore).toHaveBeenCalledTimes(1);
    expect(backup.restoreError?.code).toBe("RESTORE_NOT_CONFIRMED");
    expect(backup.restoreState).toBe("planned");
  });

  it("applies with the opt-in and the plan token after confirmation", async () => {
    const restore = vi
      .fn()
      .mockResolvedValueOnce(success(PLAN))
      .mockResolvedValueOnce(success(APPLIED, ["old archive kept"]));
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);
    await backup.planRestore(CONFIG);

    expect(backup.requestRestore()).toBe(true);
    expect(await backup.confirmRestore(CONFIG)).toBe(true);

    expect(restore).toHaveBeenLastCalledWith({
      file: ARCHIVE,
      configPath: CONFIG,
      allowWrite: true,
      confirm: "1700000000:abcdef0123",
    });
    expect(backup.restoreState).toBe("restored");
    expect(backup.restoreOutcome?.status).toBe("applied");
    expect(backup.restoreOutcome?.details).toEqual([
      { key: "restored", value: "2" },
      { key: "target_dir", value: "C:\\ws" },
    ]);
    expect(backup.restoreWarnings).toEqual(["old archive kept"]);
  });

  it("keeps apply disabled when the plan has no token", async () => {
    const restore = vi.fn(async () =>
      success({ ...PLAN, confirm_token: undefined }),
    );
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);

    expect(await backup.planRestore(CONFIG)).toBe(true);
    expect(backup.restoreReady).toBe(false);
    expect(backup.requestRestore()).toBe(false);
    expect(backup.restoreError?.code).toBe("RESTORE_TOKEN_MISSING");
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("drops the plan when the archive changes", async () => {
    const restore = vi.fn(async () => success(PLAN));
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);
    await backup.planRestore(CONFIG);

    backup.setRestoreFile("C:\\backups\\other.zip");

    expect(backup.restoreState).toBe("idle");
    expect(backup.restorePlan).toBeNull();
    expect(backup.restoreReady).toBe(false);
    expect(backup.restoreFile).toBe("C:\\backups\\other.zip");
  });

  it("surfaces a failed plan and a failed apply", async () => {
    const restore = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "the archive manifest is invalid",
          next_action: "choose a backup created by this app",
        },
        meta: {},
        warnings: [],
      })
      .mockResolvedValueOnce(success(PLAN))
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "CONFIRM_REQUIRED",
          message: "confirm token is missing, expired or does not match",
          retryable: false,
        },
        meta: {},
        warnings: [],
      });
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);

    expect(await backup.planRestore(CONFIG)).toBe(false);
    expect(backup.restoreError?.code).toBe("INVALID_INPUT");
    expect(backup.restorePlan).toBeNull();

    await backup.planRestore(CONFIG);
    backup.requestRestore();
    expect(await backup.confirmRestore(CONFIG)).toBe(false);
    expect(backup.restoreState).toBe("error");
    expect(backup.restoreError?.code).toBe("CONFIRM_REQUIRED");
    // The reviewed plan stays visible, but apply is disabled in the error state.
    expect(backup.restorePlan?.confirmToken).toBe("1700000000:abcdef0123");
    expect(backup.restoreReady).toBe(false);
  });

  it("never applies after reset and drops an in-flight plan", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    const restore = vi.fn(
      () =>
        new Promise<Envelope<unknown>>((done) => {
          resolve = done;
        }),
    );
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);
    const plan = backup.planRestore(CONFIG);
    expect(backup.planning).toBe(true);

    backup.reset();
    expect(backup.restoreState).toBe("idle");
    expect(backup.restoreFile).toBeNull();

    resolve(success(PLAN));
    expect(await plan).toBe(false);
    expect(backup.restorePlan).toBeNull();
  });

  it("reports a skipped outcome with its reason", async () => {
    const restore = vi
      .fn()
      .mockResolvedValueOnce(success(PLAN))
      .mockResolvedValueOnce(
        success({ status: "skipped", reason: "duplicate", plan: PLAN.plan }),
      );
    const backup = store(restore);
    backup.setRestoreFile(ARCHIVE);
    await backup.planRestore(CONFIG);
    backup.requestRestore();

    expect(await backup.confirmRestore(CONFIG)).toBe(true);
    expect(backup.restoreOutcome?.status).toBe("skipped");
    expect(backup.restoreOutcome?.reason).toBe("duplicate");
    expect(backup.restoreOutcome?.plan.summary).toBe(
      "restore 2 files into C:\\ws",
    );
  });
});
