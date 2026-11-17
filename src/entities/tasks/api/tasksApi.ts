import {
  cliRun,
  type CliCommandId,
  type CliRunOptions,
  type Envelope,
} from "@/shared/cli";
import type { TaskState } from "../model/types";

/**
 * Task commands are part of the 0.4.0 shell allow-list. Package A extends the
 * shared `CliCommandId`/`CliArgs` union; the narrow cast keeps this package
 * compiling in parallel without editing `src/shared/cli`.
 */
type TaskCommandId = "tasks_list" | "tasks_add" | "tasks_update";

export interface TasksListArgs {
  property?: string;
  kind?: string;
  state?: TaskState;
  limit?: number;
}

export interface TasksAddArgs {
  kind: string;
  url: string;
  rule: string;
  property?: string;
  payload?: Record<string, unknown>;
}

export interface TasksUpdateArgs {
  id: number;
  state: TaskState;
}

export interface TaskListData {
  tasks: unknown[];
}

export interface TaskMutationData {
  task?: unknown;
  outcome?: unknown;
}

function runTaskCommand<T>(
  command: TaskCommandId,
  args: object,
): Promise<Envelope<T>> {
  // The shell validates these fields against its own Rust struct; the shared
  // TypeScript union lands with package A.
  const options = { args } as unknown as CliRunOptions;
  return cliRun<T>(command as CliCommandId, options);
}

export function tasksList(args: TasksListArgs): Promise<Envelope<TaskListData>> {
  return runTaskCommand<TaskListData>("tasks_list", args);
}

export function tasksAdd(
  args: TasksAddArgs,
): Promise<Envelope<TaskMutationData>> {
  return runTaskCommand<TaskMutationData>("tasks_add", args);
}

export function tasksUpdate(
  args: TasksUpdateArgs,
): Promise<Envelope<TaskMutationData>> {
  // `CliArgs.id` is a string shared with the read-only provider ids.
  return runTaskCommand<TaskMutationData>("tasks_update", {
    id: String(args.id),
    state: args.state,
  });
}
