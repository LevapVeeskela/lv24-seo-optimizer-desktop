import { useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import {
  TASK_LIMIT_DEFAULT,
  TASK_LIMIT_OPTIONS,
  TasksStore,
  TASK_STATES,
  type TaskAddInput,
  type TaskAddResult,
  type TaskRow,
  type TaskState,
} from "@/entities/tasks";
import { TaskCard } from "@/entities/tasks/ui/TaskCard";
import { taskStateLabelKey } from "@/entities/tasks/ui/labels";
import { AddTaskForm } from "@/features/tasks/ui/AddTaskForm";
import { useI18n } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { useFeedback } from "@/shared/ui/Feedback";
import "./tasks.css";

type StateFilter = TaskState | "all";

/**
 * Local task lifecycle: list, filter, add and triage. The engine owns the
 * store, the bounded total and the transition rules; this page only sends
 * allow-listed commands and renders what came back.
 */
export const TasksPage = observer(function TasksPage() {
  const { t } = useI18n();
  const { engine, properties } = useRootStore();
  const { notify } = useFeedback();
  const [store] = useState(() => new TasksStore());
  const [property, setProperty] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState<StateFilter>("all");
  const [limit, setLimit] = useState<number>(TASK_LIMIT_DEFAULT);

  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;
  const defaultProperty = properties.project?.defaultProperty ?? "";
  const hasFilters =
    property.trim() !== "" || kind.trim() !== "" || state !== "all";

  useEffect(() => {
    if (configPath && !engine.offline) {
      void store.load(configPath, { property, kind, state, limit });
    } else {
      store.reset();
    }
  }, [configPath, engine.offline, property, kind, state, limit, store]);

  const stateOptions = useMemo(
    () =>
      TASK_STATES.map((item) => ({
        value: item,
        label: t(taskStateLabelKey(item)),
      })),
    [t],
  );

  const resetFilters = () => {
    setProperty("");
    setKind("");
    setState("all");
    setLimit(TASK_LIMIT_DEFAULT);
  };

  const refresh = () => {
    if (!blocked) {
      void store.refresh();
    }
  };

  const addTask = async (input: TaskAddInput): Promise<TaskAddResult> => {
    if (!configPath) {
      return {
        ok: false,
        error: {
          code: "CONFIG_REQUIRED",
          message: t("tasks.noWorkspaceTitle"),
          retryable: false,
        },
      };
    }
    const result = await store.add(configPath, input);
    if (result.ok) {
      const id = result.task?.id;
      const message =
        result.outcome === "existing"
          ? t("tasks.add.existing", { id: id ?? "?" })
          : result.outcome === "reopened"
            ? t("tasks.add.reopened", { id: id ?? "?" })
            : result.outcome === "created"
              ? t("tasks.add.added", { id: id ?? "?" })
              : t("tasks.add.outcomeUnknown", { id: id ?? "?" });
      notify(message, "success");
    }
    return result;
  };

  const updateTask = async (task: TaskRow, next: TaskState) => {
    if (!configPath) {
      return;
    }
    const ok = await store.updateState(configPath, task, next);
    if (ok) {
      notify(
        t("tasks.updatedToast", {
          id: task.id,
          state: t(taskStateLabelKey(next)),
        }),
        "success",
      );
    }
  };

  const updateErrorText = store.updateError
    ? store.updateError.code === "INVALID_TRANSITION" && store.lastTransition
      ? t("tasks.invalidTransition", {
          from: t(taskStateLabelKey(store.lastTransition.from)),
          to: t(taskStateLabelKey(store.lastTransition.to)),
        })
      : appErrorText(store.updateError)
    : null;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("tasks.title")}</h1>
          <p className="muted">{t("tasks.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            loading={store.loading}
            onClick={refresh}
            disabled={blocked}
          >
            {t("tasks.refresh")}
          </Button>
        </div>
      </header>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void engine.load()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("tasks.offlineTitle")}</strong>
          <span>{t("tasks.offlineHint")}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {t("tasks.openSettings")}
            </Link>
          }
        >
          <strong>{t("tasks.noWorkspaceTitle")}</strong>
          <span>{t("tasks.noWorkspaceHint")}</span>
        </Notice>
      ) : null}

      {store.error ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={refresh} disabled={blocked}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("tasks.errorTitle")}</strong>
          <span>{appErrorText(store.error)}</span>
        </Notice>
      ) : null}

      {store.updateError && updateErrorText ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={store.clearUpdateError}>
              {t("tasks.dismissError")}
            </Button>
          }
        >
          <strong>{t("tasks.updateFailed")}</strong>
          <span>{updateErrorText}</span>
        </Notice>
      ) : null}

      {store.skipped > 0 ? (
        <Notice variant="info">
          <span>{t("tasks.skipped", { count: store.skipped })}</span>
        </Notice>
      ) : null}

      {configPath && !engine.offline ? (
        <Card>
          <AddTaskForm
            disabled={blocked || store.saving}
            defaultProperty={defaultProperty}
            onSubmit={addTask}
          />
        </Card>
      ) : null}

      <Card>
        <div className="toolbar">
          <Field
            id="tasks-filter-property"
            label={t("tasks.filters.property")}
            hint={t("tasks.filters.propertyHint")}
          >
            <Input
              id="tasks-filter-property"
              type="search"
              value={property}
              placeholder={t("tasks.filters.propertyPlaceholder")}
              onChange={(event) => setProperty(event.target.value)}
              aria-describedby="tasks-filter-property-hint"
            />
          </Field>
          <Field
            id="tasks-filter-kind"
            label={t("tasks.filters.kind")}
            hint={t("tasks.filters.kindHint")}
          >
            <Input
              id="tasks-filter-kind"
              type="search"
              value={kind}
              placeholder={t("tasks.filters.kindPlaceholder")}
              onChange={(event) => setKind(event.target.value)}
              aria-describedby="tasks-filter-kind-hint"
            />
          </Field>
          <Field id="tasks-filter-state" label={t("tasks.filters.state")}>
            <Select
              id="tasks-filter-state"
              value={state}
              onChange={(event) =>
                setState(event.target.value as StateFilter)
              }
            >
              <option value="all">{t("tasks.filters.allStates")}</option>
              {stateOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="tasks-filter-limit" label={t("tasks.filters.limit")}>
            <Select
              id="tasks-filter-limit"
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
            >
              {TASK_LIMIT_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {t("tasks.filters.limitOption", { count: value })}
                </option>
              ))}
            </Select>
          </Field>
          {hasFilters ? (
            <Button variant="secondary" onClick={resetFilters}>
              {t("tasks.resetFilters")}
            </Button>
          ) : null}
        </div>

        {store.meta ? (
          <div className="form-actions">
            <span className="muted small">
              {t("tasks.count", { count: store.meta.total })}
            </span>
            {store.meta.truncated ? (
              <Badge tone="warning">
                {t("tasks.truncated", {
                  count: store.tasks.length,
                  total: store.meta.total,
                })}
              </Badge>
            ) : null}
            {store.meta.dataAgeDays !== null ? (
              <span className="muted small">
                {t("tasks.dataAge", { days: store.meta.dataAgeDays })}
              </span>
            ) : null}
          </div>
        ) : null}
      </Card>

      {(store.loading || (store.state === "idle" && !blocked)) &&
      store.tasks.length === 0 ? (
        <Loading label={t("tasks.loading")} />
      ) : null}

      {!store.loading &&
      store.state === "ready" &&
      store.tasks.length === 0 ? (
        <Card>
          <EmptyState
            title={
              hasFilters
                ? t("tasks.filteredEmptyTitle")
                : t("tasks.emptyTitle")
            }
            hint={
              hasFilters
                ? t("tasks.filteredEmptyHint")
                : t("tasks.emptyHint")
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={resetFilters}>
                  {t("tasks.resetFilters")}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : null}

      {store.tasks.length > 0 ? (
        <div className="tasks-list">
          {store.tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              updating={store.updatingId === task.id}
              disabled={store.updatingId !== null}
              onUpdate={(next) => void updateTask(task, next)}
            />
          ))}
        </div>
      ) : null}

      {store.limitations.length ? (
        <Card>
          <h4>{t("tasks.limitations")}</h4>
          <ul className="report-notes">
            {store.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {store.warnings.length ? (
        <Card>
          <h4>{t("tasks.warnings")}</h4>
          <ul className="report-notes">
            {store.warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
});
