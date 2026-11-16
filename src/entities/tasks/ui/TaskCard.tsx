import { useI18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { displayUrl, formatPayload } from "../lib/payload";
import { nextTaskStates, type TaskRow, type TaskState } from "../model/types";
import { taskStateLabelKey, taskStateTone } from "./labels";

export interface TaskCardProps {
  task: TaskRow;
  updating: boolean;
  disabled?: boolean;
  onUpdate: (state: TaskState) => void;
}

/**
 * One tracked finding. The payload is evidence, not a settings dump: it is
 * rendered behind a disclosure, redacted, and never fetched or edited here.
 */
export function TaskCard({
  task,
  updating,
  disabled = false,
  onUpdate,
}: TaskCardProps) {
  const { t, locale } = useI18n();
  const payloadKeys = Object.keys(task.payload);
  const transitions = nextTaskStates(task.state);
  const busy = updating || disabled;

  return (
    <Card className="task-card">
      <div className="task-card-header">
        <div>
          <p className="eyebrow">#{task.id}</p>
          <h3 className="task-url">
            <code>{displayUrl(task.url)}</code>
          </h3>
          <div className="badge-row">
            <Badge tone="info">{task.kind}</Badge>
            <Badge tone={taskStateTone(task.state)}>
              {t(taskStateLabelKey(task.state))}
            </Badge>
          </div>
        </div>
      </div>

      <div className="report-facts">
        <span>
          {t("tasks.property")}: <code>{task.propertyId}</code>
        </span>
        <span>
          {t("tasks.rule")}: <code>{task.ruleId}</code>
        </span>
        {task.updatedAt ? (
          <span>
            {t("tasks.updatedAt", {
              value: formatDateTime(task.updatedAt, locale),
            })}
          </span>
        ) : null}
        {task.createdAt ? (
          <span>
            {t("tasks.createdAt", {
              value: formatDateTime(task.createdAt, locale),
            })}
          </span>
        ) : null}
      </div>

      {payloadKeys.length ? (
        <details className="task-evidence">
          <summary>
            {t("tasks.evidenceCount", { count: payloadKeys.length })}
          </summary>
          <pre className="task-payload">{formatPayload(task.payload)}</pre>
        </details>
      ) : (
        <p className="muted small">{t("tasks.noEvidence")}</p>
      )}

      {transitions.length ? (
        <div
          className="task-actions"
          role="group"
          aria-label={t("tasks.transitions")}
        >
          {transitions.map((state) => (
            <Button
              key={state}
              variant="secondary"
              disabled={busy}
              onClick={() => onUpdate(state)}
              aria-label={t("tasks.moveTo", {
                state: t(taskStateLabelKey(state)),
              })}
            >
              {t(taskStateLabelKey(state))}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
