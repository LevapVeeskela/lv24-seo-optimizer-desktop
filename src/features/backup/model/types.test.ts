import { describe, expect, it } from "vitest";
import { backupLimitations, normalizeBackupResult } from "./types";

const PAYLOAD = {
  archive_path: "C:\\backups\\lv24-seo-backup-20261116T101500Z.zip",
  archive_size: 2048,
  archive_sha256: "abc123",
  manifest: {
    format: "lv24-seo-backup",
    format_version: 1,
    engine_version: "0.5.4",
    schema_version: 7,
    engine_schema_version: 7,
    created_at: "2026-11-16T10:15:00+00:00",
    files: [
      { path: "seo.toml", size: 300, sha256: "s1" },
      { path: "data/seo.sqlite3", size: 1700, sha256: "s2" },
      { size: 10 },
      "nope",
    ],
    totals: { files: 2, size: 2000 },
    summary: {
      config_source: "file",
      database_present: true,
      secrets_included: false,
      schema_version: 7,
      properties: 2,
      snapshots: 5,
      latest_snapshot_at: "2026-11-15T09:00:00+00:00",
    },
    limitations: ["secrets.json is not included"],
  },
  summary: {
    created_at: "2026-11-16T10:15:00+00:00",
    engine_version: "0.5.4",
    files: ["seo.toml", "data/seo.sqlite3"],
    total_size: 2000,
  },
};

describe("normalizeBackupResult", () => {
  it("maps the archive and its manifest", () => {
    const result = normalizeBackupResult(PAYLOAD);

    expect(result.archive_path).toBe(
      "C:\\backups\\lv24-seo-backup-20261116T101500Z.zip",
    );
    expect(result.archive_size).toBe(2048);
    expect(result.archive_sha256).toBe("abc123");
    expect(result.manifest.format).toBe("lv24-seo-backup");
    expect(result.manifest.schema_version).toBe(7);
    expect(result.manifest.files.map((file) => file.path)).toEqual([
      "seo.toml",
      "data/seo.sqlite3",
    ]);
    expect(result.manifest.totals).toEqual({ files: 2, size: 2000 });
    expect(result.manifest.summary.database_present).toBe(true);
    expect(result.manifest.summary.snapshots).toBe(5);
    expect(result.manifest.limitations).toEqual([
      "secrets.json is not included",
    ]);
  });

  it("falls back to the flat summary an older engine returns", () => {
    const result = normalizeBackupResult({
      archive_path: "C:\\b.zip",
      summary: { database_present: false, engine_version: "0.5.3" },
    });

    expect(result.manifest.summary.database_present).toBe(false);
    expect(result.manifest.summary.engine_version).toBe("0.5.3");
    expect(result.manifest.files).toEqual([]);
  });

  it("tolerates a malformed payload without inventing values", () => {
    const result = normalizeBackupResult(null);

    expect(result.archive_path).toBeNull();
    expect(result.archive_size).toBeNull();
    expect(result.archive_sha256).toBeNull();
    expect(result.manifest.summary.secrets_included).toBeNull();
    expect(result.manifest.limitations).toEqual([]);
  });
});

describe("backupLimitations", () => {
  it("de-duplicates and trims manifest limitations", () => {
    const result = normalizeBackupResult({
      manifest: { limitations: ["a", " ", "a", "b"] },
    });
    expect(backupLimitations(result)).toEqual(["a", "b"]);
    expect(backupLimitations(null)).toEqual([]);
  });
});
