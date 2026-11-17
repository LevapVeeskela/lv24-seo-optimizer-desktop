import { isRecord, numberValue, stringValue } from "@/shared/lib/format";
import type { AppError } from "@/shared/lib/errors";

/** One flattened plan/result member for the summary tables. */
export interface IndexingDetail {
  key: string;
  value: string;
}

export type IndexingOutcomeStatus = "applied" | "skipped" | "unknown";

/**
 * Normalized two-phase write plan. The engine owns the payload; every field is
 * optional so an unexpected response renders an empty plan instead of throwing
 * in the panel. `confirmToken` is the only field the apply phase needs.
 */
export interface IndexingPlan {
  status: string | null;
  action: string | null;
  target: string | null;
  summary: string | null;
  planHash: string | null;
  confirmToken: string | null;
  ttlSeconds: number | null;
  details: IndexingDetail[];
  limitations: string[];
}

export interface IndexingOutcome {
  status: IndexingOutcomeStatus;
  reason: string | null;
  plan: IndexingPlan | null;
  details: IndexingDetail[];
  /** IndexNow reports `result.rows[0].submitted`; other actions leave it null. */
  submitted: number | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim() !== "",
      )
    : [];
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/** Deterministic one-line rendering; long nested values are bounded. */
function detailText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(detailText).join(", ");
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    const encoded = JSON.stringify(value);
    return encoded.length > 400 ? `${encoded.slice(0, 400)}…` : encoded;
  } catch {
    return String(value);
  }
}

/** Flatten one object into sorted key/value rows. */
export function indexingDetails(value: unknown): IndexingDetail[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.entries(value)
    .filter(([, item]) => item !== null && item !== undefined)
    .map(([key, item]) => ({ key, value: detailText(item) }))
    .sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    );
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function normalizeIndexingPlan(value: unknown): IndexingPlan {
  const data = record(value);
  const plan = record(data.plan);
  return {
    status: stringValue(data.status),
    action: stringValue(plan.action),
    target: stringValue(plan.target),
    summary: stringValue(plan.summary),
    planHash:
      stringValue(data.plan_hash) ??
      stringValue(data.planHash) ??
      stringValue(plan.plan_hash),
    confirmToken:
      stringValue(data.confirm_token) ?? stringValue(data.confirmToken),
    ttlSeconds:
      numberValue(data.ttl_seconds) ?? numberValue(data.ttlSeconds),
    details: indexingDetails(plan.payload),
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(plan.limitations),
    ]),
  };
}

function normalizeStatus(value: string | null): IndexingOutcomeStatus {
  if (value === "applied") {
    return "applied";
  }
  if (value === "skipped") {
    return "skipped";
  }
  return "unknown";
}

/** Sum `result.rows[].submitted`; the engine may split one batch per row. */
function submittedCount(result: Record<string, unknown>): number | null {
  const rows = Array.isArray(result.rows) ? result.rows : [];
  const counts = rows
    .map((row) => (isRecord(row) ? numberValue(row.submitted) : null))
    .filter((value): value is number => value !== null);
  if (counts.length) {
    return counts.reduce((total, value) => total + value, 0);
  }
  return numberValue(result.submitted) ?? null;
}

/**
 * Normalized apply response. The engine echoes the reviewed plan; keep the
 * plan's fields when the echo is partial so the result card stays complete.
 */
export function normalizeIndexingOutcome(
  value: unknown,
  reviewed: IndexingPlan | null,
): IndexingOutcome {
  const data = record(value);
  const echoed = normalizeIndexingPlan(data);
  const result = isRecord(data.result) ? data.result : null;
  const plan: IndexingPlan = {
    ...echoed,
    action: echoed.action ?? reviewed?.action ?? null,
    target: echoed.target ?? reviewed?.target ?? null,
    summary: echoed.summary ?? reviewed?.summary ?? null,
    planHash: echoed.planHash ?? reviewed?.planHash ?? null,
    confirmToken: echoed.confirmToken ?? reviewed?.confirmToken ?? null,
    ttlSeconds: echoed.ttlSeconds ?? reviewed?.ttlSeconds ?? null,
    details: echoed.details.length ? echoed.details : (reviewed?.details ?? []),
    limitations: echoed.limitations.length
      ? echoed.limitations
      : (reviewed?.limitations ?? []),
  };
  return {
    status: normalizeStatus(stringValue(data.status)),
    reason: stringValue(data.reason),
    plan,
    details: result ? indexingDetails(result) : [],
    submitted: result ? submittedCount(result) : null,
  };
}

export type IndexingErrorHint = "auth" | "engine" | null;

/**
 * A missing Bing key and an engine without the 0.9.0 commands both need a
 * different action; the panel must not present either as a generic failure.
 */
export function indexingErrorHint(error: AppError | null): IndexingErrorHint {
  if (!error) {
    return null;
  }
  if (error.code === "AUTH_REQUIRED" || error.code === "MISSING_TOKEN") {
    return "auth";
  }
  if (error.code === "CLI_INVALID_JSON" || error.code === "INVALID_COMMAND") {
    return "engine";
  }
  return null;
}
