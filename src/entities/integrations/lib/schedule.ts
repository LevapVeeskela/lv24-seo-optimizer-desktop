import type { MessageKey, MessageParams } from "@/shared/i18n";
import type { ScheduleView } from "../model/types";

/**
 * Local, conservative cron check before the engine call: it catches empty
 * expressions, a wrong field count and out-of-range values. The engine stays
 * authoritative and still rejects shapes that systemd or Task Scheduler cannot
 * express (for example ranges or steps).
 */
export type CronIssue =
  | { kind: "empty" }
  | { kind: "fields"; count: number }
  | { kind: "field"; field: number };

export type CronValidation =
  | { valid: true }
  | { valid: false; issue: CronIssue };

const FIELD_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 7], // day of week; 0 and 7 are Sunday
];

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function inRange(value: number, field: number): boolean {
  const [min, max] = FIELD_RANGES[field];
  return value >= min && value <= max;
}

function numericToken(token: string, field: number): number | null {
  if (/^\d+$/.test(token)) {
    return Number(token);
  }
  const names = field === 3 ? MONTH_NAMES : field === 4 ? DAY_NAMES : null;
  if (!names) {
    return null;
  }
  const index = names.indexOf(token.toLowerCase());
  if (index < 0) {
    return null;
  }
  return field === 3 ? index + 1 : index;
}

function validBase(base: string, field: number): boolean {
  if (base === "*") {
    return true;
  }
  const range = base.split("-");
  if (range.length === 2) {
    const start = numericToken(range[0], field);
    const end = numericToken(range[1], field);
    return (
      start !== null &&
      end !== null &&
      start <= end &&
      inRange(start, field) &&
      inRange(end, field)
    );
  }
  if (range.length > 2) {
    return false;
  }
  const value = numericToken(base, field);
  return value !== null && inRange(value, field);
}

function validField(value: string, field: number): boolean {
  return value.split(",").every((part) => {
    if (!part) {
      return false;
    }
    const pieces = part.split("/");
    if (pieces.length > 2) {
      return false;
    }
    if (pieces.length === 2) {
      if (!/^\d+$/.test(pieces[1]) || Number(pieces[1]) < 1) {
        return false;
      }
    }
    return validBase(pieces[0], field);
  });
}

export function validateCron(expression: string): CronValidation {
  const trimmed = expression.trim();
  if (!trimmed) {
    return { valid: false, issue: { kind: "empty" } };
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return { valid: false, issue: { kind: "fields", count: fields.length } };
  }
  for (let index = 0; index < fields.length; index += 1) {
    if (!validField(fields[index], index)) {
      return { valid: false, issue: { kind: "field", field: index + 1 } };
    }
  }
  return { valid: true };
}

export function cronIssueKey(issue: CronIssue): MessageKey {
  if (issue.kind === "empty") {
    return "integrations.schedule.cronEmpty";
  }
  return issue.kind === "fields"
    ? "integrations.schedule.cronFields"
    : "integrations.schedule.cronField";
}

export function cronIssueParams(
  issue: CronIssue,
): MessageParams | undefined {
  if (issue.kind === "fields") {
    return { count: issue.count };
  }
  if (issue.kind === "field") {
    return { field: issue.field };
  }
  return undefined;
}

/** Clipboard payload for "copy artifact": command plus every rendered file. */
export function formatScheduleArtifact(view: ScheduleView): string {
  const lines = [
    `target: ${view.target ?? "unknown"}`,
    `dry_run: ${view.dryRun ? "yes" : "no"}`,
    `command: ${view.command ?? ""}`,
  ];
  for (const file of view.files) {
    lines.push(`${file.name}:`, file.content.replace(/\r?\n$/, ""));
  }
  return lines.join("\n");
}
