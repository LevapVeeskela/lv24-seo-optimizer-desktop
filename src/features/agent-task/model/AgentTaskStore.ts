import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { makeAutoObservable } from "mobx";
import {
  addAgentTask,
  createAgentTask,
  loadAgentTaskQueue,
  removeAgentTask,
  saveAgentTaskQueue,
  setAgentTaskStatus,
  type AgentTaskStorage,
} from "../lib/queue";
import type { AgentTask, AgentTaskStatus } from "./types";

function browserStorage(): AgentTaskStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * localStorage-backed queue for agent tasks. The store is deliberately small
 * and has no provider/CLI calls: prompts are built from the stored snapshot.
 */
export class AgentTaskStore {
  tasks: AgentTask[] = [];
  private storage: AgentTaskStorage | null;
  private now: () => Date;

  constructor(
    storage: AgentTaskStorage | null = browserStorage(),
    now: () => Date = () => new Date(),
  ) {
    this.storage = storage;
    this.now = now;
    this.tasks = loadAgentTaskQueue(storage);
    makeAutoObservable<AgentTaskStore, "storage" | "now">(
      this,
      { storage: false, now: false },
      { autoBind: true },
    );
  }

  get size(): number {
    return this.tasks.length;
  }

  has(id: string): boolean {
    return this.tasks.some((task) => task.id === id);
  }

  add(
    recommendation: Recommendation,
    property: string | null | undefined,
    period: RecommendationPeriod | null | undefined,
  ): AgentTask {
    const task = createAgentTask(recommendation, property, period, this.now());
    const next = addAgentTask(this.tasks, task);
    if (next !== this.tasks) {
      this.tasks = next;
      saveAgentTaskQueue(this.storage, next);
    }
    return task;
  }

  remove(id: string): void {
    const next = removeAgentTask(this.tasks, id);
    if (next !== this.tasks) {
      this.tasks = next;
      saveAgentTaskQueue(this.storage, next);
    }
  }

  markCopied(id: string): void {
    this.setStatus(id, "copied");
  }

  markExported(id: string): void {
    this.setStatus(id, "exported");
  }

  clear(): void {
    if (this.tasks.length === 0) {
      return;
    }
    this.tasks = [];
    saveAgentTaskQueue(this.storage, []);
  }

  private setStatus(id: string, status: AgentTaskStatus): void {
    const next = setAgentTaskStatus(this.tasks, id, status, this.now());
    if (next !== this.tasks) {
      this.tasks = next;
      saveAgentTaskQueue(this.storage, next);
    }
  }
}
