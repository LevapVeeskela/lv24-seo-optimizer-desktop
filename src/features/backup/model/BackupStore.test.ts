import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import { BackupStore } from "./BackupStore";
import { formatBytes } from "./format";

const PAYLOAD = {
  archive_path: "C:\\backups\\lv24-seo-backup-20261116T101500Z.zip",
  archive_size: 2048,
  archive_sha256: "abc123",
  manifest: {
    format: "lv24-seo-backup",
    files: [{ path: "seo.toml", size: 300, sha256: "s1" }],
    limitations: ["secrets.json is not included"],
    summary: { database_present: true },
  },
};

function success(data: unknown = PAYLOAD): Envelope<unknown> {
  return { ok: true, data, meta: {}, warnings: ["config only"] };
}

function store(create: ReturnType<typeof vi.fn>) {
  return new BackupStore(
    create as unknown as typeof import("../lib/ipc").runBackupCreate,
    () => new Date("2026-11-16T10:00:00Z"),
  );
}

describe("BackupStore", () => {
  it("sends the output directory and force flag to backup_create", async () => {
    const create = vi.fn(async () => success());
    const backup = store(create);
    backup.setOutDir("C:\\backups");
    backup.setForce(true);

    expect(await backup.run()).toBe(true);

    expect(create).toHaveBeenCalledWith({
      out: "C:\\backups",
      force: true,
    });
    expect(backup.state).toBe("ready");
    expect(backup.result?.archive_path).toContain("lv24-seo-backup");
    expect(backup.result?.manifest.summary.database_present).toBe(true);
    expect(backup.warnings).toEqual(["config only"]);
    expect(backup.lastRunAt).toBe("2026-11-16T10:00:00.000Z");
  });

  it("refuses to run without an output directory", async () => {
    const create = vi.fn(async () => success());
    const backup = store(create);

    expect(await backup.run()).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(backup.error?.code).toBe("BACKUP_OUT_MISSING");
  });

  it("rejects an ok envelope without a data object", async () => {
    const create = vi.fn(async () => ({
      ok: true,
      data: null,
      meta: {},
      warnings: [],
    }));
    const backup = store(create);
    backup.setOutDir("C:\\backups");

    expect(await backup.run()).toBe(false);
    expect(backup.error?.code).toBe("INVALID_BACKUP_RESULT");
    expect(backup.result).toBeNull();
  });

  it("keeps the previous archive visible when a rerun fails", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "the archive already exists",
          next_action: "pass --force to replace it",
        },
        meta: {},
        warnings: [],
      });
    const backup = store(create);
    backup.setOutDir("C:\\backups");
    expect(await backup.run()).toBe(true);

    expect(await backup.run()).toBe(false);
    expect(backup.state).toBe("error");
    expect(backup.error?.code).toBe("INVALID_INPUT");
    expect(backup.result?.archive_sha256).toBe("abc123");
  });

  it("ignores an in-flight run after reset", async () => {
    let resolve!: (value: Envelope<unknown>) => void;
    const create = vi.fn(
      () =>
        new Promise<Envelope<unknown>>((done) => {
          resolve = done;
        }),
    );
    const backup = store(create);
    backup.setOutDir("C:\\backups");
    const run = backup.run();
    expect(backup.creating).toBe(true);

    backup.reset();
    expect(backup.state).toBe("idle");
    expect(backup.outDir).toBeNull();

    resolve(success());
    expect(await run).toBe(false);
    expect(backup.result).toBeNull();
  });
});

describe("formatBytes", () => {
  it("formats known sizes and keeps an unknown size unknown", () => {
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(2048, "en")).toBe("2 KB");
    expect(formatBytes(1536, "en")).toBe("1.5 KB");
    expect(formatBytes(null, "en")).toBe("—");
    expect(formatBytes(-1, "en")).toBe("—");
  });
});
