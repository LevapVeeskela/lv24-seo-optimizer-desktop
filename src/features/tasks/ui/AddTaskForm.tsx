import { useEffect, useState, type FormEvent } from "react";
import type {
  TaskAddInput,
  TaskAddResult,
} from "@/entities/tasks/model/TasksStore";
import {
  useI18n,
  type MessageKey,
  type MessageParams,
} from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Notice } from "@/shared/ui/Notice";
import {
  EMPTY_ADD_TASK_FORM,
  validateAddTaskForm,
  type AddTaskFieldError,
  type AddTaskFormErrors,
  type AddTaskFormValues,
} from "../lib/form";

export interface AddTaskFormProps {
  disabled?: boolean;
  defaultProperty?: string;
  onSubmit: (input: TaskAddInput) => Promise<TaskAddResult>;
}

function fieldErrorText(
  error: AddTaskFieldError | undefined,
  t: (key: MessageKey, params?: MessageParams) => string,
): string | undefined {
  if (!error) {
    return undefined;
  }
  switch (error.code) {
    case "required":
      return t("tasks.add.error.required");
    case "invalidJson":
      return t("tasks.add.error.invalidJson", { detail: error.detail });
    case "notObject":
      return t("tasks.add.error.notObject");
    case "secretKey":
      return t("tasks.add.error.secret", { path: error.path });
  }
}

/**
 * Add-task form. The engine is idempotent on the identity tuple, so the UI
 * does not pre-check whether a task exists: the returned outcome is reported
 * honestly by the page.
 */
export function AddTaskForm({
  disabled = false,
  defaultProperty = "",
  onSubmit,
}: AddTaskFormProps) {
  const { t } = useI18n();
  const [values, setValues] = useState<AddTaskFormValues>({
    ...EMPTY_ADD_TASK_FORM,
    property: defaultProperty,
  });
  const [errors, setErrors] = useState<AddTaskFormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<AppError | null>(null);

  useEffect(() => {
    // The workspace property may arrive after the page mounts; only fill an
    // untouched optional field.
    setValues((current) =>
      current.property ? current : { ...current, property: defaultProperty },
    );
  }, [defaultProperty]);

  const busy = submitting || disabled;

  const change = (field: keyof AddTaskFormValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSubmitError(null);
  };

  const reset = () => {
    setValues({ ...EMPTY_ADD_TASK_FORM, property: defaultProperty });
    setErrors({});
    setSubmitError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAddTaskForm(values);
    if (!validation.ok) {
      setErrors(validation.errors);
      setSubmitError(null);
      return;
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await onSubmit(validation.input);
      if (result.ok) {
        setValues({ ...EMPTY_ADD_TASK_FORM, property: defaultProperty });
      } else {
        setSubmitError(result.error);
      }
    } catch (error) {
      setSubmitError({
        code: "ADD_TASK_FAILED",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const errorText = (error: AddTaskFieldError | undefined) =>
    fieldErrorText(error, t);

  return (
    <form className="task-add-form" onSubmit={(event) => void submit(event)}>
      <div className="card-header">
        <div>
          <h2>{t("tasks.add.title")}</h2>
          <p className="muted small">{t("tasks.add.hint")}</p>
        </div>
      </div>

      {submitError ? (
        <Notice variant="error">
          <strong>{t("tasks.add.failed")}</strong>
          <span>{appErrorText(submitError)}</span>
        </Notice>
      ) : null}

      <div className="form-grid">
        <Field
          id="task-add-kind"
          label={t("tasks.add.kind")}
          required
          error={errorText(errors.kind)}
        >
          <Input
            id="task-add-kind"
            value={values.kind}
            onChange={(event) => change("kind", event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.kind)}
            aria-describedby={errors.kind ? "task-add-kind-error" : undefined}
          />
        </Field>
        <Field
          id="task-add-url"
          label={t("tasks.add.url")}
          required
          error={errorText(errors.url)}
        >
          <Input
            id="task-add-url"
            value={values.url}
            onChange={(event) => change("url", event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.url)}
            aria-describedby={errors.url ? "task-add-url-error" : undefined}
          />
        </Field>
        <Field
          id="task-add-rule"
          label={t("tasks.add.rule")}
          required
          error={errorText(errors.rule)}
        >
          <Input
            id="task-add-rule"
            value={values.rule}
            onChange={(event) => change("rule", event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.rule)}
            aria-describedby={errors.rule ? "task-add-rule-error" : undefined}
          />
        </Field>
        <Field
          id="task-add-property"
          label={t("tasks.add.property")}
          hint={t("tasks.add.propertyHint")}
        >
          <Input
            id="task-add-property"
            value={values.property}
            onChange={(event) => change("property", event.target.value)}
            disabled={busy}
            aria-describedby="task-add-property-hint"
          />
        </Field>
        <Field
          id="task-add-payload"
          label={t("tasks.add.payload")}
          hint={t("tasks.add.payloadHint")}
          error={errorText(errors.payload)}
        >
          <textarea
            id="task-add-payload"
            className="input"
            rows={4}
            value={values.payload}
            onChange={(event) => change("payload", event.target.value)}
            disabled={busy}
            aria-invalid={Boolean(errors.payload)}
            aria-describedby={
              errors.payload
                ? "task-add-payload-hint task-add-payload-error"
                : "task-add-payload-hint"
            }
          />
        </Field>
      </div>

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={submitting} disabled={disabled}>
          {submitting ? t("tasks.add.adding") : t("tasks.add.submit")}
        </Button>
        <Button variant="secondary" onClick={reset} disabled={busy}>
          {t("tasks.add.reset")}
        </Button>
      </div>
    </form>
  );
}
