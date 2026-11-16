import { isRecord, numberValue, stringValue } from "@/shared/lib/format";

/** Closed task-state set, mirroring `TASK_STATES` in the engine store. */
export const TASK_STATES = [
  "open",
  "in_progress",
  "verified",
  "dismissed",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/**
 * Allowed moves, mirroring the engine. Re-applying the current state is an
 * accepted no-op; the UI hides it from the action buttons.
 */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  open: ["in_progress", "verified", "dismissed"],
  in_progress: ["open", "verified", "dismissed"],
  verified: ["open", "dismissed"],
  dismissed: ["open", "in_progress"],
};

export const TASK_LIMIT_DEFAULT = 200;
export const TASK_LIMIT_MAX = 500;
export const TASK_LIMIT_OPTIONS = [50, 100, 200, 500] as const;

export interface TaskRow {
  id: number;
  kind: string;
  propertyId: string;
  url: string;
  ruleId: string;
  state: TaskState;
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface TaskQuery {
  property?: string | null;
  kind?: string | null;
  state?: TaskState | "all" | null;
  limit?: number | null;
}

export interface NormalizedTaskQuery {
  property?: string;
  kind?: string;
  state?: TaskState;
  limit: number;
}

export interface TaskListMeta {
  limit: number;
  count: number;
  total: number;
  truncated: boolean;
  dataAgeDays: number | null;
  propertyId: string | null;
  kind: string | null;
  state: TaskState | null;
  limitations: string[];
}

export interface TaskListMapping {
  tasks: TaskRow[];
  /** Rows the engine returned but the UI could not trust. */
  skipped: number;
}

export function isTaskState(value: unknown): value is TaskState {
  return (
    typeof value === "string" &&
    (TASK_STATES as readonly string[]).includes(value)
  );
}

/** Targets offered for a row; the current state is not repeated. */
export function nextTaskStates(state: TaskState): TaskState[] {
  return TASK_TRANSITIONS[state].filter((next) => next !== state);
}

/** The engine accepts a same-state update as a no-op. */
export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

/**
 * Map one engine task. A row without a numeric id or a known state is not
 * guessed at; the caller reports it as skipped instead.
 */
export function mapTask(raw: unknown): TaskRow | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = numberValue(raw.id);
  if (id === null || !Number.isInteger(id)) {
    return null;
  }
  const kind = stringValue(raw.kind)?.trim();
  const propertyId = stringValue(raw.property_id)?.trim();
  const url = stringValue(raw.url)?.trim();
  const ruleId =
    stringValue(raw.rule_id)?.trim() ?? stringValue(raw.rule)?.trim();
  const state = raw.state;
  if (!kind || !propertyId || !url || !ruleId || !isTaskState(state)) {
    return null;
  }
  return {
    id,
    kind,
    propertyId,
    url,
    ruleId,
    state,
    payload: isRecord(raw.payload) ? raw.payload : {},
    createdAt: stringValue(raw.created_at)?.trim() ?? "",
    updatedAt: stringValue(raw.updated_at)?.trim() ?? "",
  };
}

/** `null` means the envelope had no task array at all (a contract failure). */
export function mapTaskList(data: unknown): TaskListMapping | null {
  if (!isRecord(data) || !Array.isArray(data.tasks)) {
    return null;
  }
  const tasks: TaskRow[] = [];
  let skipped = 0;
  for (const item of data.tasks) {
    const task = mapTask(item);
    if (task) {
      tasks.push(task);
    } else {
      skipped += 1;
    }
  }
  return { tasks, skipped };
}

export function mapTaskListMeta(
  meta: unknown,
  taskCount: number,
): TaskListMeta {
  const record = isRecord(meta) ? meta : {};
  const count = numberValue(record.count) ?? taskCount;
  const total = numberValue(record.total) ?? count;
  const limit = numberValue(record.limit) ?? TASK_LIMIT_DEFAULT;
  const state = record.state;
  return {
    limit,
    count,
    total,
    truncated: record.truncated === true || count < total,
    dataAgeDays: numberValue(record.data_age_days),
    propertyId: stringValue(record.property_id),
    kind: stringValue(record.kind),
    state: isTaskState(state) ? state : null,
    limitations: stringList(record.limitations),
  };
}

export function normalizeTaskQuery(
  query: TaskQuery = {},
): NormalizedTaskQuery {
  const property = query.property?.trim();
  const kind = query.kind?.trim();
  const state = query.state && query.state !== "all" ? query.state : undefined;
  const rawLimit = numberValue(query.limit);
  const limit =
    rawLimit === null
      ? TASK_LIMIT_DEFAULT
      : Math.min(TASK_LIMIT_MAX, Math.max(1, Math.trunc(rawLimit)));
  return {
    ...(property ? { property } : {}),
    ...(kind ? { kind } : {}),
    ...(state ? { state } : {}),
    limit,
  };
}

export function sameTaskQuery(
  left: NormalizedTaskQuery,
  right: NormalizedTaskQuery,
): boolean {
  return (
    left.property === right.property &&
    left.kind === right.kind &&
    left.state === right.state &&
    left.limit === right.limit
  );
}

/**
 * Local filter used by tests and by callers that already hold a page of
 * tasks. The page itself asks the engine to filter so `total` stays honest.
 */
export function filterTasks(tasks: TaskRow[], query: TaskQuery): TaskRow[] {
  const normalized = normalizeTaskQuery(query);
  return tasks.filter(
    (task) =>
      (normalized.property === undefined ||
        task.propertyId === normalized.property) &&
      (normalized.kind === undefined || task.kind === normalized.kind) &&
      (normalized.state === undefined || task.state === normalized.state),
  );
}
