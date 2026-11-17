import type { ReactNode } from "react";
import { useI18n } from "@/shared/i18n";
import { appErrorText, type AppError } from "@/shared/lib/errors";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Notice } from "@/shared/ui/Notice";
import type { ReportMeta } from "../model/types";

/** One titled block inside a platform tab. */
export function Section({
  id,
  title,
  hint,
  actions,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="diagnostics-section" aria-labelledby={id}>
      <div className="card-header">
        <div>
          <h3 id={id}>{title}</h3>
          {hint ? <p className="muted small">{hint}</p> : null}
        </div>
        {actions ? <div className="form-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="diagnostics-fact">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function Warnings({ items }: { items: string[] }) {
  const { t } = useI18n();
  const warnings = [...new Set(items.filter((item) => item.trim() !== ""))];
  if (!warnings.length) {
    return null;
  }
  return (
    <div>
      <h4>{t("diagnostics.warnings")}</h4>
      <ul className="report-notes">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Coverage facts every bounded answer carries. `limitations` is always shown
 * when the engine reports one; truncation is stated either way so an empty
 * list is not mistaken for a complete answer.
 */
export function MetaNotes({
  meta,
  showSampling = false,
}: {
  meta: ReportMeta;
  showSampling?: boolean;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="diagnostics-meta">
      <div className="diagnostics-facts">
        {meta.total !== null ? (
          <Fact
            label={t("diagnostics.meta.total")}
            value={formatNumber(meta.total, locale)}
          />
        ) : null}
        <Fact
          label={t("diagnostics.meta.truncated")}
          value={
            <Badge tone={meta.truncated ? "warning" : "neutral"}>
              {meta.truncated ? t("common.yes") : t("common.no")}
            </Badge>
          }
        />
        {meta.dataAgeDays !== null ? (
          <Fact
            label={t("diagnostics.meta.dataAge")}
            value={t("diagnostics.meta.dataAgeValue", {
              days: formatNumber(meta.dataAgeDays, locale),
            })}
          />
        ) : null}
        {meta.start || meta.end ? (
          <Fact
            label={t("diagnostics.meta.window")}
            value={`${meta.start ?? "—"} … ${meta.end ?? "—"}`}
          />
        ) : null}
        {meta.organicOnly !== null ? (
          <Fact
            label={t("diagnostics.meta.organic")}
            value={
              meta.organicOnly
                ? t("diagnostics.meta.organicOnly")
                : t("diagnostics.meta.allTraffic")
            }
          />
        ) : null}
        {showSampling && meta.sampled !== null ? (
          <Fact
            label={t("diagnostics.meta.sampled")}
            value={
              meta.sampled
                ? t("diagnostics.meta.estimates")
                : t("diagnostics.meta.exact")
            }
          />
        ) : null}
        {showSampling && meta.sampleShare !== null ? (
          <Fact
            label={t("diagnostics.meta.sampleShare")}
            value={`${formatNumber(meta.sampleShare * 100, locale, 1)}%`}
          />
        ) : null}
        {showSampling && meta.sampleSize !== null ? (
          <Fact
            label={t("diagnostics.meta.sampleSize")}
            value={formatNumber(meta.sampleSize, locale)}
          />
        ) : null}
        {showSampling && meta.sampleSpace !== null ? (
          <Fact
            label={t("diagnostics.meta.sampleSpace")}
            value={formatNumber(meta.sampleSpace, locale)}
          />
        ) : null}
        {showSampling && meta.dataLag !== null ? (
          <Fact
            label={t("diagnostics.meta.dataLag")}
            value={formatNumber(meta.dataLag, locale)}
          />
        ) : null}
        {showSampling && meta.totalRowsRounded !== null ? (
          <Fact
            label={t("diagnostics.meta.totalRowsRounded")}
            value={
              meta.totalRowsRounded ? t("common.yes") : t("common.no")
            }
          />
        ) : null}
      </div>
      {meta.limitations.length ? (
        <div>
          <h4>{t("diagnostics.meta.limitations")}</h4>
          <ul className="report-notes">
            {meta.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="muted small">{t("diagnostics.meta.noLimitations")}</p>
      )}
    </div>
  );
}

export function ErrorNotice({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: AppError;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const engineHint =
    error.code === "CLI_INVALID_JSON" ||
    error.code === "INVALID_COMMAND" ||
    error.code === "CLI_FAILED";
  return (
    <Notice
      variant="error"
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        ) : undefined
      }
    >
      <strong>{title}</strong>
      <span>{appErrorText(error)}</span>
      <code className="callback">
        {t("integrations.errorCode", { code: error.code })}
      </code>
      {error.code === "AUTH_REQUIRED" || error.code === "MISSING_TOKEN" ? (
        <span>{t("diagnostics.requiresKey")}</span>
      ) : null}
      {engineHint ? <span>{t("diagnostics.engineHint")}</span> : null}
    </Notice>
  );
}

/**
 * Provider-empty answers are explicit states. A blank table is never shown as
 * zero rows of data.
 */
export function EmptyReport({
  reason,
  title,
  hint,
}: {
  reason: "no_rows_for_window" | "provider_returned_no_rows" | "low_traffic";
  title: string;
  hint?: string;
}) {
  const { t } = useI18n();
  const text =
    reason === "low_traffic"
      ? t("diagnostics.empty.lowTraffic")
      : reason === "provider_returned_no_rows"
        ? t("diagnostics.empty.providerReturnedNoRows")
        : t("diagnostics.empty.noRowsForWindow");
  return (
    <EmptyState
      title={title}
      hint={[text, hint].filter(Boolean).join(" ")}
    />
  );
}
