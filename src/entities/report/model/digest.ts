import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import type { ReportSection, WeeklyReport } from "./types";

export type DigestDirection = "up" | "down" | "flat" | null;
export type DigestConfidence = "high" | "medium" | "low" | "unknown";

export interface DigestChange {
  current: number | null;
  previous: number | null;
  absDelta: number | null;
  pctDelta: number | null;
  direction: DigestDirection;
  good: boolean | null;
}

export interface DigestEvidence {
  kind: string | null;
  url: string | null;
  ruleId: string | null;
  severity: string | null;
  change: string | null;
  reason: string | null;
  field: string | null;
  value: string | null;
  date: string | null;
  extra: Record<string, unknown>;
}

export interface DigestItem {
  metric: string;
  change: DigestChange;
  cause: string;
  confidence: DigestConfidence;
  evidence: DigestEvidence[];
  nextAction: string | null;
}

export interface ReportDigest {
  section: ReportSection;
  items: DigestItem[];
  total: number;
  truncated: boolean;
  dataAge: string | null;
  limitations: string[];
  skipped: number;
}

const EVIDENCE_KEYS = new Set([
  "kind",
  "url",
  "rule_id",
  "rule",
  "severity",
  "change",
  "reason",
  "field",
  "value",
  "date",
]);

// Evidence is rendered as text, but a hand-edited report must not leak a
// credential-shaped extra field into the card.
const SECRET_KEY_RE =
  /(?:^|[_-])(token|secret|password|api[_-]?key|authorization)$/i;
const REDACTED = "[redacted]";
const MAX_DEPTH = 12;

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = SECRET_KEY_RE.test(key)
      ? REDACTED
      : redact(item, depth + 1);
  }
  return result;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function directionValue(value: unknown): DigestDirection {
  return value === "up" || value === "down" || value === "flat"
    ? value
    : null;
}

function confidenceValue(value: unknown): DigestConfidence {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "unknown";
}

function parseEvidence(raw: unknown): DigestEvidence | null {
  if (!isRecord(raw)) {
    return null;
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!EVIDENCE_KEYS.has(key)) {
      extra[key] = redact(value);
    }
  }
  const evidence: DigestEvidence = {
    kind: stringValue(raw.kind)?.trim() ?? null,
    url: stringValue(raw.url)?.trim() ?? null,
    ruleId:
      stringValue(raw.rule_id)?.trim() ??
      stringValue(raw.rule)?.trim() ??
      null,
    severity: stringValue(raw.severity)?.trim() ?? null,
    change: stringValue(raw.change)?.trim() ?? null,
    reason: stringValue(raw.reason)?.trim() ?? null,
    field: stringValue(raw.field)?.trim() ?? null,
    value: textValue(raw.value),
    date: stringValue(raw.date)?.trim() ?? null,
    extra,
  };
  return evidence.kind || evidence.url || evidence.ruleId || evidence.reason || evidence.field
    ? evidence
    : null;
}

function parseChange(raw: unknown): DigestChange {
  const change = isRecord(raw) ? raw : {};
  const current = numberValue(change.current);
  const previous = numberValue(change.previous);
  return {
    current,
    previous,
    absDelta:
      numberValue(change.abs_delta) ??
      (current !== null && previous !== null ? current - previous : null),
    pctDelta: numberValue(change.pct_delta),
    direction: directionValue(change.direction),
    good: typeof change.good === "boolean" ? change.good : null,
  };
}

function parseItem(raw: unknown): DigestItem | null {
  if (!isRecord(raw)) {
    return null;
  }
  const metric = stringValue(raw.metric)?.trim();
  if (!metric) {
    return null;
  }
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence
        .map(parseEvidence)
        .filter((item): item is DigestEvidence => item !== null)
    : [];
  return {
    metric,
    change: parseChange(raw.change),
    cause: stringValue(raw.cause)?.trim() ?? "unknown",
    confidence: confidenceValue(raw.confidence),
    evidence,
    nextAction: stringValue(raw.next_action)?.trim() ?? null,
  };
}

export function isDigestSection(value: unknown): value is ReportSection {
  if (
    !isRecord(value) ||
    typeof value.key !== "string" ||
    typeof value.title !== "string"
  ) {
    return false;
  }
  // `kind` is the 0.4.0 contract. The engine still emits the section by `key`
  // only, so accept that shape until the payload gains the discriminator.
  return value.kind === "digest" || (value.kind === undefined && value.key === "digest");
}

/** The first section explicitly marked `kind: "digest"`, or `null`. */
export function reportDigestSection(
  report: WeeklyReport | null,
): ReportSection | null {
  if (!report || !Array.isArray(report.sections)) {
    return null;
  }
  return report.sections.find(isDigestSection) ?? null;
}

/** `null` when the section is absent or not marked as a digest. */
export function parseDigest(
  section: ReportSection | null,
): ReportDigest | null {
  if (!section || !isDigestSection(section)) {
    return null;
  }
  const rows = Array.isArray(section.rows) ? section.rows : [];
  const items: DigestItem[] = [];
  let skipped = 0;
  for (const row of rows) {
    const item = parseItem(row);
    if (item) {
      items.push(item);
    } else {
      skipped += 1;
    }
  }
  const limitations = [
    ...new Set([
      ...stringList(section.limitations),
      ...stringList(section.notes),
    ]),
  ];
  return {
    section,
    items,
    total: numberValue(section.total) ?? items.length,
    truncated: section.truncated === true,
    dataAge: stringValue(section.data_age),
    limitations,
    skipped,
  };
}

/** Only absolute http(s) evidence becomes a link; everything else stays text. */
export function safeEvidenceUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Evidence text without embedded credentials; relative paths stay unchanged. */
export function displayEvidenceUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
      return url.href;
    }
    return value;
  } catch {
    return value;
  }
}
