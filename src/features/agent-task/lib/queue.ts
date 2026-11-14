import {
  isRecommendation,
  type Recommendation,
  type RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { isRecord } from "@/shared/lib/format";
import {
  AGENT_TASK_STATUSES,
  type AgentTask,
  type AgentTaskStatus,
} from "../model/types";

export const AGENT_TASK_QUEUE_KEY = "lv24.agent-tasks.v1";

export interface AgentTaskStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export function isAgentTaskStatus(value: unknown): value is AgentTaskStatus {
  return (
    typeof value === "string" &&
    (AGENT_TASK_STATUSES as readonly string[]).includes(value)
  );
}

function isPeriod(value: unknown): value is RecommendationPeriod {
  return (
    isRecord(value) &&
    typeof value.start === "string" &&
    value.start.trim() !== "" &&
    typeof value.end === "string" &&
    value.end.trim() !== ""
  );
}

function isAgentTask(value: unknown): value is AgentTask {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    isRecommendation(value.recommendation) &&
    value.recommendation.id === value.id &&
    (value.property === null || typeof value.property === "string") &&
    (value.period === null || isPeriod(value.period)) &&
    isAgentTaskStatus(value.status) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

/** Snapshot one recommendation into a draft queue item. */
export function createAgentTask(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
  now: Date = new Date(),
): AgentTask {
  const timestamp = now.toISOString();
  const trimmedProperty =
    typeof property === "string" && property.trim() ? property.trim() : null;
  return {
    id: recommendation.id,
    recommendation,
    property: trimmedProperty,
    period: period ? { start: period.start, end: period.end } : null,
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Add a task once; an existing id wins and the array identity is preserved. */
export function addAgentTask(
  tasks: AgentTask[],
  task: AgentTask,
): AgentTask[] {
  if (tasks.some((item) => item.id === task.id)) {
    return tasks;
  }
  return [...tasks, task];
}

export function removeAgentTask(
  tasks: AgentTask[],
  id: string,
): AgentTask[] {
  return tasks.some((item) => item.id === id)
    ? tasks.filter((item) => item.id !== id)
    : tasks;
}

/** Update the last action status; unknown ids are a no-op. */
export function setAgentTaskStatus(
  tasks: AgentTask[],
  id: string,
  status: AgentTaskStatus,
  now: Date = new Date(),
): AgentTask[] {
  if (!tasks.some((item) => item.id === id)) {
    return tasks;
  }
  const timestamp = now.toISOString();
  return tasks.map((item) =>
    item.id === id ? { ...item, status, updatedAt: timestamp } : item,
  );
}

/** Tolerant parser for localStorage: bad JSON and bad items are dropped. */
export function parseAgentTaskQueue(raw: string | null): AgentTask[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const seen = new Set<string>();
  const tasks: AgentTask[] = [];
  for (const item of parsed) {
    if (!isAgentTask(item) || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    tasks.push(item);
  }
  return tasks;
}

export function serializeAgentTaskQueue(tasks: AgentTask[]): string {
  return JSON.stringify(tasks);
}

export function loadAgentTaskQueue(
  storage: AgentTaskStorage | null,
): AgentTask[] {
  try {
    return parseAgentTaskQueue(storage?.getItem(AGENT_TASK_QUEUE_KEY) ?? null);
  } catch {
    return [];
  }
}

export function saveAgentTaskQueue(
  storage: AgentTaskStorage | null,
  tasks: AgentTask[],
): void {
  try {
    storage?.setItem(AGENT_TASK_QUEUE_KEY, serializeAgentTaskQueue(tasks));
  } catch {
    // A locked-down storage backend must not break the workbench.
  }
}

/** Deterministic, filesystem-safe Markdown filename for one task. */
export function agentTaskFilename(id: string): string {
  const slug =
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "recommendation";
  return `${slug}.md`;
}
