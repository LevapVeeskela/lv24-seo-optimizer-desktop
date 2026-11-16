import { isRecord } from "@/shared/lib/format";
import { scheduleView, type ScheduleFile, type ScheduleView } from "@/entities/integrations";

/**
 * Normalized `schedule install` result. The engine renders the artefact first
 * and then applies it, so the same fields as `schedule print` are present plus
 * `installed` and the written file paths.
 */
export interface ScheduleInstallResult extends ScheduleView {
  installed: boolean;
  paths: ScheduleFile[];
}

function pathEntries(value: unknown): ScheduleFile[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, content]) => ({ name, content }));
}

export function scheduleInstallView(raw: unknown): ScheduleInstallResult {
  const record = isRecord(raw) ? raw : {};
  return {
    ...scheduleView(raw),
    installed: record.installed === true,
    paths: pathEntries(record.paths),
  };
}
