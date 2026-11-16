import { useI18n } from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import {
  type DiffUnavailableReason,
  type ReportDiff,
} from "@/entities/report/model/diff";
import type { DiffState } from "@/entities/report/model/ReportsStore";
import { reportDiffCopy } from "@/entities/report/model/copy";
import { ReportDiffView } from "@/entities/report/ui/ReportDiffView";

/**
 * Page-level states for "Compare with previous": idle, loading, the documented
 * "fewer than two snapshots" empty state, and a real error. The diff itself is
 * rendered by the entity view so the weekly report layout stays untouched.
 */
export function ReportDiffCard({
  state,
  diff,
  unavailable,
  error,
  warnings,
  disabled,
  onCompare,
}: {
  state: DiffState;
  diff: ReportDiff | null;
  unavailable: DiffUnavailableReason | null;
  error: AppError | null;
  warnings: string[];
  disabled: boolean;
  onCompare: () => void;
}) {
  const { t, locale } = useI18n();
  const copy = reportDiffCopy(locale);

  if (state === "ready" && diff) {
    return <ReportDiffView diff={diff} warnings={warnings} />;
  }

  const retry = (
    <Button variant="secondary" onClick={onCompare} disabled={disabled}>
      {t("common.retry")}
    </Button>
  );

  return (
    <Card className="report-diff">
      <div className="card-header">
        <div>
          <p className="eyebrow">{copy.title}</p>
          <p className="muted small">{copy.hint}</p>
        </div>
      </div>

      {state === "loading" ? (
        <Loading label={copy.comparing} />
      ) : state === "empty" ? (
        <EmptyState
          title={
            unavailable === "no_store" ? copy.noStoreTitle : copy.emptyTitle
          }
          hint={unavailable === "no_store" ? copy.noStoreHint : copy.emptyHint}
          action={retry}
        />
      ) : state === "error" ? (
        <Notice variant="error" action={retry}>
          <strong>{copy.errorTitle}</strong>
          <span>
            {error ? appErrorText(error) : t("common.notAvailable")}
          </span>
        </Notice>
      ) : (
        <EmptyState
          title={copy.idleTitle}
          hint={copy.idleHint}
          action={
            <Button variant="secondary" onClick={onCompare} disabled={disabled}>
              {copy.compare}
            </Button>
          }
        />
      )}
    </Card>
  );
}
