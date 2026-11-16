import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/** One payload member of the archive. */
export interface BackupFileEntry {
  path: string;
  size: number | null;
  sha256: string | null;
}

export interface BackupManifestTotals {
  files: number | null;
  size: number | null;
}

export interface BackupManifestSummary {
  created_at: string | null;
  engine_version: string | null;
  schema_version: number | null;
  engine_schema_version: number | null;
  config_source: string | null;
  database_present: boolean | null;
  secrets_included: boolean | null;
  properties: number | null;
  snapshots: number | null;
  latest_snapshot_at: string | null;
}

export interface BackupManifest {
  format: string | null;
  format_version: number | null;
  created_at: string | null;
  engine_version: string | null;
  schema_version: number | null;
  engine_schema_version: number | null;
  files: BackupFileEntry[];
  totals: BackupManifestTotals;
  summary: BackupManifestSummary;
  limitations: string[];
}

export interface BackupResult {
  archive_path: string | null;
  archive_size: number | null;
  archive_sha256: string | null;
  manifest: BackupManifest;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeFiles(value: unknown): BackupFileEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const files: BackupFileEntry[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const path = stringValue(item.path);
    if (!path) {
      continue;
    }
    files.push({
      path,
      size: numberValue(item.size),
      sha256: stringValue(item.sha256),
    });
  }
  return files;
}

function normalizeSummary(value: unknown): BackupManifestSummary {
  const data = isRecord(value) ? value : {};
  return {
    created_at: stringValue(data.created_at),
    engine_version: stringValue(data.engine_version),
    schema_version: numberValue(data.schema_version),
    engine_schema_version: numberValue(data.engine_schema_version),
    config_source: stringValue(data.config_source),
    database_present: booleanValue(data.database_present),
    secrets_included: booleanValue(data.secrets_included),
    properties: numberValue(data.properties),
    snapshots: numberValue(data.snapshots),
    latest_snapshot_at: stringValue(data.latest_snapshot_at),
  };
}

/**
 * Map the `backup_create` payload into the panel model. The manifest is the
 * authoritative contract; a missing nested summary falls back to the flat
 * top-level `summary` the CLI also returns, so an older engine still renders.
 */
export function normalizeBackupResult(value: unknown): BackupResult {
  const data = isRecord(value) ? value : {};
  const manifest = isRecord(data.manifest) ? data.manifest : {};
  const totals = isRecord(manifest.totals) ? manifest.totals : {};
  const summary = isRecord(manifest.summary)
    ? manifest.summary
    : isRecord(data.summary)
      ? data.summary
      : {};
  return {
    archive_path: stringValue(data.archive_path),
    archive_size: numberValue(data.archive_size),
    archive_sha256: stringValue(data.archive_sha256),
    manifest: {
      format: stringValue(manifest.format),
      format_version: numberValue(manifest.format_version),
      created_at: stringValue(manifest.created_at),
      engine_version: stringValue(manifest.engine_version),
      schema_version: numberValue(manifest.schema_version),
      engine_schema_version: numberValue(manifest.engine_schema_version),
      files: normalizeFiles(manifest.files),
      totals: {
        files: numberValue(totals.files),
        size: numberValue(totals.size),
      },
      summary: normalizeSummary(summary),
      limitations: stringList(manifest.limitations),
    },
  };
}

/** Manifest limitations, de-duplicated and trimmed. */
export function backupLimitations(result: BackupResult | null): string[] {
  if (!result) {
    return [];
  }
  return [
    ...new Set(
      result.manifest.limitations.filter((item) => item.trim() !== ""),
    ),
  ];
}
