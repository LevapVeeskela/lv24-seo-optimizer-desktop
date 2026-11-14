import { observer } from "mobx-react-lite";
import { recommendationSourceLabel } from "@/entities/recommendation/model/copy";
import { useRecommendationCopy } from "@/entities/recommendation/model/useRecommendationCopy";
import type { AgentTask } from "../model/types";
import type { AgentTaskStore } from "../model/AgentTaskStore";
import {
  copyRecommendationPrompt,
  exportRecommendationPrompt,
} from "../lib/actions";
import { useI18n } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { useFeedback } from "@/shared/ui/Feedback";

function statusTone(
  status: AgentTask["status"],
): "neutral" | "info" | "success" {
  if (status === "copied") {
    return "info";
  }
  if (status === "exported") {
    return "success";
  }
  return "neutral";
}

export const AgentQueue = observer(function AgentQueue({
  store,
}: {
  store: AgentTaskStore;
}) {
  const { locale } = useI18n();
  const copy = useRecommendationCopy();
  const { notify } = useFeedback();

  const copyTask = async (task: AgentTask) => {
    const ok = await copyRecommendationPrompt(
      task.recommendation,
      task.property,
      task.period,
    );
    if (ok) {
      store.markCopied(task.id);
      notify(copy.copied);
    } else {
      notify(copy.copyFailed, "error");
    }
  };

  const exportTask = (task: AgentTask) => {
    const ok = exportRecommendationPrompt(
      task.recommendation,
      task.property,
      task.period,
    );
    if (ok) {
      store.markExported(task.id);
      notify(copy.exported);
    } else {
      notify(copy.exportFailed, "error");
    }
  };

  const removeTask = (task: AgentTask) => {
    store.remove(task.id);
    notify(copy.removed);
  };

  const clearQueue = () => {
    store.clear();
    notify(copy.queueCleared);
  };

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{copy.queueTitle}</h2>
          <p className="muted small">{copy.queueHint}</p>
        </div>
        <div className="badge-row">
          <Badge tone="neutral">{store.size}</Badge>
          {store.size > 0 ? (
            <Button variant="ghost" className="btn-small" onClick={clearQueue}>
              {copy.queueClear}
            </Button>
          ) : null}
        </div>
      </div>

      {store.size === 0 ? (
        <p className="muted small">{copy.queueEmpty}</p>
      ) : (
        <ul className="connection-list">
          {store.tasks.map((task) => (
            <li className="connection-row" key={task.id}>
              <div className="connection-main">
                <strong>{task.recommendation.title}</strong>
                <span className="connection-meta">
                  {recommendationSourceLabel(
                    task.recommendation.source,
                    task.recommendation.provider,
                  )}{" "}
                  · {formatDateTime(task.updatedAt, locale)}
                </span>
              </div>
              <div className="connection-badges">
                <Badge tone={statusTone(task.status)}>
                  {copy.status[task.status]}
                </Badge>
                <Button
                  variant="secondary"
                  className="btn-small"
                  onClick={() => void copyTask(task)}
                >
                  {copy.copyPrompt}
                </Button>
                <Button
                  variant="secondary"
                  className="btn-small"
                  onClick={() => exportTask(task)}
                >
                  {copy.exportMd}
                </Button>
                <Button
                  variant="ghost"
                  className="btn-small"
                  onClick={() => removeTask(task)}
                >
                  {copy.remove}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
});
