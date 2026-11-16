import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/** One flattened `plan.payload` / `result` member for the summary table. */
export interface RestoreDetail {
  key: string;
  value: string;
}

export type RestoreOutcomeStatus = "applied" | "skipped" | "unknown";

/**
 * Normalized `backup restore` plan. The engine owns the payload; every field is
 * optional so an unexpected response renders an empty plan instead of throwing
 * in the page. `confirmToken` is the only field the apply phase needs.
 */
export interface RestorePlan {
  status: string | null;
  action: string | null;
  target: string | null;
  summary: string | null;
  planHash: string | null;
  confirmToken: string | null;
  ttlSeconds: number | null;
  details: RestoreDetail[];
  limitations: string[];
}

export interface RestoreOutcome {
  status: RestoreOutcomeStatus;
  reason: string | null;
  plan: RestorePlan;
  details: RestoreDetail[];
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
export function restoreDetails(value: unknown): RestoreDetail[] {
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

function planRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function normalizeRestorePlan(value: unknown): RestorePlan {
  const data = planRecord(value);
  const plan = planRecord(data.plan);
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
    details: restoreDetails(plan.payload),
    limitations: unique([
      ...stringList(data.limitations),
      ...stringList(plan.limitations),
    ]),
  };
}

function normalizeStatus(value: string | null): RestoreOutcomeStatus {
  if (value === "applied") {
    return "applied";
  }
  if (value === "skipped") {
    return "skipped";
  }
  return "unknown";
}

/**
 * Normalized apply response. The engine echoes the plan; keep the reviewed
 * plan's fields when the echo is partial so the result card stays complete.
 */
export function normalizeRestoreOutcome(
  value: unknown,
  reviewed: RestorePlan | null,
): RestoreOutcome {
  const data = planRecord(value);
  const echoed = normalizeRestorePlan(data);
  const plan: RestorePlan = {
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
    details: restoreDetails(data.result),
  };
}
