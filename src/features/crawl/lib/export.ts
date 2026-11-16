import type { CrawlMeta, CrawlResult } from "@/entities/crawl";
import { crawlIssuesCsv, crawlResultJson } from "@/entities/crawl";
import { writeTextFile } from "@/shared/desktop/files";
import { toAppError, type AppError } from "@/shared/lib/errors";

export type CrawlExportFormat = "json" | "csv";

export interface CrawlExportInput {
  format: CrawlExportFormat;
  result: CrawlResult;
  /** Exact `data` payload from the CLI envelope, used by the JSON export. */
  raw: unknown;
  meta: CrawlMeta;
  warnings: readonly string[];
  exportDir?: string | null;
  now?: Date;
}

export interface CrawlExportOutcome {
  status: "exported" | "failed";
  path?: string;
  bytes?: number;
  error?: AppError;
}

function siteSlug(siteUrl: string | null): string {
  if (!siteUrl) {
    return "site";
  }
  try {
    const host = new URL(siteUrl).hostname
      .replace(/[^a-z0-9.-]+/gi, "-")
      .replace(/^-+|-+$/g, "");
    return host || "site";
  } catch {
    return "site";
  }
}

function timestamp(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(
    11,
    13,
  )}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

/** Deterministic, collision-resistant-enough name; no user text is trusted. */
export function crawlExportFilename(
  format: CrawlExportFormat,
  siteUrl: string | null,
  now: Date = new Date(),
): string {
  return `crawl-${siteSlug(siteUrl)}-${timestamp(now)}.${format}`;
}

export function joinExportPath(directory: string, filename: string): string {
  const base = directory.replace(/[\\/]+$/, "");
  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${separator}${filename}`;
}

/**
 * Write one export under the shell's app export root. The path is built here,
 * never picked by the user, so the shell allow-list cannot be widened by the
 * renderer; a denied or failed write is returned as a typed error.
 */
export async function exportCrawl(
  input: CrawlExportInput,
): Promise<CrawlExportOutcome> {
  const exportDir = input.exportDir?.trim() ?? "";
  if (!exportDir) {
    return {
      status: "failed",
      error: {
        code: "EXPORT_DIR_UNAVAILABLE",
        message: "The app export directory is unavailable.",
        retryable: false,
      },
    };
  }

  const filename = crawlExportFilename(
    input.format,
    input.result.summary.site_url ?? input.result.summary.start_url,
    input.now,
  );
  const path = joinExportPath(exportDir, filename);
  const content =
    input.format === "json"
      ? crawlResultJson(input.raw, input.meta, input.warnings)
      : crawlIssuesCsv(input.result.issues);

  try {
    const saved = await writeTextFile(path, content);
    return { status: "exported", path: saved.path, bytes: saved.bytes };
  } catch (error) {
    return { status: "failed", error: toAppError(error, "EXPORT_WRITE") };
  }
}
