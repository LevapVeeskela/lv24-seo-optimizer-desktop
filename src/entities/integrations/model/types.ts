/**
 * Read-only integration contracts: MCP client snippets and host scheduler
 * artifacts. Nothing here writes a file or installs a job.
 */

export const MCP_CLIENTS = ["claude", "opencode", "vscode", "cursor"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export const SNIPPET_FORMATS = ["json", "toml"] as const;
export type SnippetFormat = (typeof SNIPPET_FORMATS)[number];

export const SCHEDULE_TARGETS = ["cron", "systemd", "windows"] as const;
export type ScheduleTarget = (typeof SCHEDULE_TARGETS)[number];

export function isMcpClient(value: unknown): value is McpClient {
  return (
    typeof value === "string" &&
    (MCP_CLIENTS as readonly string[]).includes(value)
  );
}

export function isSnippetFormat(value: unknown): value is SnippetFormat {
  return (
    typeof value === "string" &&
    (SNIPPET_FORMATS as readonly string[]).includes(value)
  );
}

export function isScheduleTarget(value: unknown): value is ScheduleTarget {
  return (
    typeof value === "string" &&
    (SCHEDULE_TARGETS as readonly string[]).includes(value)
  );
}

/**
 * The host platform reported by `shell_status` (`std::env::consts::OS`), with
 * the aliases older shells used. An unknown platform keeps the engine's own
 * default target, cron.
 */
export function defaultScheduleTarget(
  platform: string | null | undefined,
): ScheduleTarget {
  const value = platform?.trim().toLowerCase();
  if (value === "windows" || value === "win32") {
    return "windows";
  }
  if (value === "linux") {
    return "systemd";
  }
  return "cron";
}

export interface ScheduleFile {
  name: string;
  content: string;
}

/**
 * Normalized `schedule_print` data. The engine owns the payload; every field
 * is optional here so an unexpected response renders an empty artifact
 * instead of throwing in the page.
 */
export interface ScheduleView {
  target: string | null;
  dryRun: boolean;
  command: string | null;
  files: ScheduleFile[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];
}

export function scheduleView(raw: unknown): ScheduleView {
  const record = isRecord(raw) ? raw : {};
  const files = isRecord(record.files)
    ? Object.entries(record.files)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([name, content]) => ({ name, content }))
    : [];
  return {
    target: typeof record.target === "string" ? record.target : null,
    dryRun: record.dry_run === true,
    command: typeof record.command === "string" ? record.command : null,
    files,
    warnings: stringList(record.warnings),
  };
}
