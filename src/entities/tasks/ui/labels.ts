import type { MessageKey } from "@/shared/i18n";
import type { TaskState } from "../model/types";

const STATE_KEYS: Record<TaskState, MessageKey> = {
  open: "tasks.state.open",
  in_progress: "tasks.state.in_progress",
  verified: "tasks.state.verified",
  dismissed: "tasks.state.dismissed",
};

export type TaskBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const STATE_TONES: Record<TaskState, TaskBadgeTone> = {
  open: "warning",
  in_progress: "info",
  verified: "success",
  dismissed: "neutral",
};

export function taskStateLabelKey(state: TaskState): MessageKey {
  return STATE_KEYS[state];
}

export function taskStateTone(state: TaskState): TaskBadgeTone {
  return STATE_TONES[state];
}
