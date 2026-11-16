import { toAppError, type AppError } from "@/shared/lib/errors";
import { isRecord } from "@/shared/lib/format";
import { makeAutoObservable } from "mobx";
import {
  tasksAdd,
  tasksList,
  tasksUpdate,
  type TasksAddArgs,
} from "../api/tasksApi";
import {
  canTransition,
  mapTask,
  mapTaskList,
  mapTaskListMeta,
  normalizeTaskQuery,
  sameTaskQuery,
  type NormalizedTaskQuery,
  type TaskListMeta,
  type TaskQuery,
  type TaskRow,
  type TaskState,
} from "./types";

export type TasksState = "idle" | "loading" | "ready" | "error";
export type TaskAddOutcome = "created" | "existing" | "reopened" | "unknown";
export type TaskAddInput = Omit<TasksAddArgs, "payload"> & {
  payload?: Record<string, unknown>;
};

export type TaskAddResult =
  | { ok: true; task: TaskRow | null; outcome: TaskAddOutcome }
  | { ok: false; error: AppError };

export interface TaskTransition {
  from: TaskState;
  to: TaskState;
}

function addOutcome(value: unknown): TaskAddOutcome {
  return value === "created" || value === "existing" || value === "reopened"
    ? value
    : "unknown";
}

/**
 * Page-local task list. Every read and write goes through the shell's
 * allow-listed `tasks_*` commands; the store never edits SQLite itself.
 */
export class TasksStore {
  state: TasksState = "idle";
  tasks: TaskRow[] = [];
  meta: TaskListMeta | null = null;
  warnings: string[] = [];
  limitations: string[] = [];
  skipped = 0;
  error: AppError | null = null;
  configPath: string | null = null;
  query: NormalizedTaskQuery = normalizeTaskQuery();

  addState: "idle" | "saving" = "idle";
  addError: AppError | null = null;
  updatingId: number | null = null;
  updateError: AppError | null = null;
  lastTransition: TaskTransition | null = null;

  private generation = 0;

  constructor() {
    makeAutoObservable<TasksStore, "generation">(
      this,
      { generation: false },
      { autoBind: true },
    );
  }

  get loading(): boolean {
    return this.state === "loading";
  }

  get saving(): boolean {
    return this.addState === "saving";
  }

  get hasTasks(): boolean {
    return this.tasks.length > 0;
  }

  /**
   * Load the page. A filter change clears the previous rows first so a slow
   * response cannot show the old filter's tasks under the new controls.
   */
  async load(
    configPath: string,
    query: TaskQuery = this.query,
  ): Promise<boolean> {
    const path = configPath.trim();
    if (!path) {
      return false;
    }
    const normalized = normalizeTaskQuery(query);
    const changed =
      !sameTaskQuery(this.query, normalized) ||
      (this.configPath !== null && this.configPath !== path);
    const generation = ++this.generation;
    this.configPath = path;
    this.query = normalized;
    this.state = "loading";
    this.error = null;
    this.updateError = null;
    this.lastTransition = null;
    if (changed) {
      this.tasks = [];
      this.meta = null;
      this.skipped = 0;
    }
    const result = await tasksList(normalized);
    if (generation !== this.generation) {
      return false;
    }
    if (!result.ok) {
      this.tasks = [];
      this.meta = null;
      this.limitations = [];
      this.skipped = 0;
      this.warnings = result.warnings;
      this.error = toAppError(result.error, "CLI_FAILED");
      this.state = "error";
      return false;
    }
    const mapping = mapTaskList(result.data);
    if (!mapping) {
      this.tasks = [];
      this.meta = null;
      this.limitations = [];
      this.skipped = 0;
      this.warnings = result.warnings;
      this.error = {
        code: "INVALID_TASKS_RESULT",
        message: "tasks_list returned no task array",
        retryable: false,
      };
      this.state = "error";
      return false;
    }
    const meta = mapTaskListMeta(result.meta, mapping.tasks.length);
    this.tasks = mapping.tasks;
    this.meta = meta;
    this.limitations = meta.limitations;
    this.skipped = mapping.skipped;
    this.warnings = result.warnings;
    this.state = "ready";
    return true;
  }

  refresh(): Promise<boolean> {
    return this.configPath
      ? this.load(this.configPath, this.query)
      : Promise.resolve(false);
  }

  /**
   * `tasks_add` is idempotent; `outcome` tells the user whether the row was
   * created, already tracked or reopened after a regression. A successful add
   * refreshes the bounded list so the new row is visible under the filters.
   */
  async add(configPath: string, input: TaskAddInput): Promise<TaskAddResult> {
    if (this.addState === "saving") {
      return {
        ok: false,
        error: {
          code: "TASKS_BUSY",
          message: "a task is already being added",
          retryable: true,
        },
      };
    }
    const path = configPath.trim();
    if (!path) {
      return {
        ok: false,
        error: {
          code: "CONFIG_REQUIRED",
          message: "a workspace configuration is required",
          retryable: false,
        },
      };
    }
    this.addState = "saving";
    this.addError = null;
    this.configPath = path;
    const result = await tasksAdd(input);
    this.addState = "idle";
    if (!result.ok) {
      this.addError = toAppError(result.error, "CLI_FAILED");
      return { ok: false, error: this.addError };
    }
    const data = isRecord(result.data) ? result.data : {};
    const task = mapTask(data.task);
    const outcome = addOutcome(data.outcome);
    // The add succeeded even if the refresh below fails; the page reports the
    // add and shows the list error separately.
    await this.refresh();
    return { ok: true, task, outcome };
  }

  /**
   * Validate the transition locally (the engine validates again) and replace
   * the single row on success. The list is not re-read, so filters and the
   * bounded total stay stable.
   */
  async updateState(
    configPath: string,
    task: TaskRow,
    next: TaskState,
  ): Promise<boolean> {
    if (this.updatingId !== null) {
      return false;
    }
    if (!canTransition(task.state, next)) {
      this.lastTransition = { from: task.state, to: next };
      this.updateError = {
        code: "INVALID_TRANSITION",
        message: `invalid task transition ${task.state} -> ${next}`,
        retryable: false,
      };
      return false;
    }
    this.configPath = configPath.trim() || this.configPath;
    this.updatingId = task.id;
    this.updateError = null;
    this.lastTransition = null;
    const result = await tasksUpdate({ id: task.id, state: next });
    if (!result.ok) {
      this.updatingId = null;
      this.updateError = toAppError(result.error, "CLI_FAILED");
      return false;
    }
    const data = isRecord(result.data) ? result.data : {};
    const updated = mapTask(data.task);
    if (updated) {
      this.tasks = this.tasks.map((item) =>
        item.id === updated.id ? updated : item,
      );
    } else {
      void this.refresh();
    }
    this.updatingId = null;
    return true;
  }

  clearUpdateError(): void {
    this.updateError = null;
    this.lastTransition = null;
  }

  /** Drop the previous workspace's rows and any in-flight response. */
  reset(): void {
    this.generation += 1;
    this.state = "idle";
    this.tasks = [];
    this.meta = null;
    this.warnings = [];
    this.limitations = [];
    this.skipped = 0;
    this.error = null;
    this.configPath = null;
    this.query = normalizeTaskQuery();
    this.addState = "idle";
    this.addError = null;
    this.updatingId = null;
    this.updateError = null;
    this.lastTransition = null;
  }
}
