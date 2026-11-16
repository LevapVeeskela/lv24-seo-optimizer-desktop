import { findSecretPath } from "@/entities/tasks/lib/payload";
import type { TaskAddInput } from "@/entities/tasks/model/TasksStore";
import { isRecord } from "@/shared/lib/format";

export interface AddTaskFormValues {
  kind: string;
  url: string;
  rule: string;
  property: string;
  payload: string;
}

export const EMPTY_ADD_TASK_FORM: AddTaskFormValues = {
  kind: "",
  url: "",
  rule: "",
  property: "",
  payload: "",
};

export type AddTaskFieldError =
  | { code: "required" }
  | { code: "invalidJson"; detail: string }
  | { code: "notObject" }
  | { code: "secretKey"; path: string };

export interface AddTaskFormErrors {
  kind?: AddTaskFieldError;
  url?: AddTaskFieldError;
  rule?: AddTaskFieldError;
  payload?: AddTaskFieldError;
}

export type AddTaskValidation =
  | { ok: true; input: TaskAddInput }
  | { ok: false; errors: AddTaskFormErrors };

/**
 * Validate the form before the shell sees it. The engine rejects the same
 * credential-shaped payload keys again; this copy exists so the error lands on
 * the field instead of in a generic CLI failure.
 */
export function validateAddTaskForm(
  values: AddTaskFormValues,
): AddTaskValidation {
  const kind = values.kind.trim();
  const url = values.url.trim();
  const rule = values.rule.trim();
  const property = values.property.trim();
  const rawPayload = values.payload.trim();
  const errors: AddTaskFormErrors = {};

  if (!kind) {
    errors.kind = { code: "required" };
  }
  if (!url) {
    errors.url = { code: "required" };
  }
  if (!rule) {
    errors.rule = { code: "required" };
  }

  let payload: Record<string, unknown> | undefined;
  if (rawPayload) {
    let decoded: unknown = undefined;
    try {
      decoded = JSON.parse(rawPayload);
    } catch (error) {
      errors.payload = {
        code: "invalidJson",
        detail: error instanceof Error ? error.message : "",
      };
    }
    if (decoded !== undefined) {
      if (!isRecord(decoded)) {
        errors.payload = { code: "notObject" };
      } else {
        const secretPath = findSecretPath(decoded);
        if (secretPath) {
          errors.payload = { code: "secretKey", path: secretPath };
        } else {
          payload = decoded;
        }
      }
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    input: {
      kind,
      url,
      rule,
      ...(property ? { property } : {}),
      ...(payload ? { payload } : {}),
    },
  };
}
