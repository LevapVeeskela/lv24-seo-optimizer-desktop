import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";
import { pickBackupArchive } from "../lib/ipc";
import type { BackupStore } from "../model/BackupStore";
import type { RestoreDetail, RestoreOutcomeStatus } from "../model/restore";
import "./backup.css";

const STATUS_KEYS: Record<RestoreOutcomeStatus, MessageKey> = {
  applied: "backup.restore.status.applied",
  skipped: "backup.restore.status.skipped",
  unknown: "backup.restore.status.unknown",
};

function DetailTable({
  caption,
  keyHeader,
  valueHeader,
  details,
}: {
  caption: string;
  keyHeader: string;
  valueHeader: string;
  details: RestoreDetail[];
}) {
  return (
    <Table caption={caption} className="backup-files-table">
      <thead>
        <tr>
          <th scope="col">{keyHeader}</th>
          <th scope="col">{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {details.map((detail) => (
          <tr key={detail.key}>
            <td>
              <code>{detail.key}</code>
            </td>
            <td>{detail.value}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export interface RestoreSectionProps {
  store: BackupStore;
  configPath: string | null;
  blocked: boolean;
  /** Called after a successful apply so the shell can re-read the workspace. */
  onRestored?: () => void;
}

/**
 * Two-phase restore UI. `Review restore` builds a read-only plan; the only path
 * to a write is the explicit confirmation dialog, which calls the store's
 * `confirmRestore`. Nothing here can auto-apply a plan.
 */
export const RestoreSection = observer(function RestoreSection({
  store,
  configPath,
  blocked,
  onRestored,
}: RestoreSectionProps) {
  const { t } = useI18n();
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(
    () => () => {
      // Leaving the panel must not leave a confirmation armed.
      store.cancelRestore();
    },
    [store],
  );

  const plan = store.restorePlan;
  const outcome = store.restoreOutcome;
  const warnings = [
    ...new Set(store.restoreWarnings.filter((item) => item.trim() !== "")),
  ];
  const busy = store.planning || store.restoring;

  const pick = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const file = await pickBackupArchive();
      if (file) {
        store.setRestoreFile(file);
      }
    } catch {
      setPickError(t("backup.restore.pickFailed"));
    } finally {
      setPicking(false);
    }
  };

  const review = async () => {
    if (blocked || busy) {
      return;
    }
    await store.planRestore(configPath);
  };

  const requestRestore = () => {
    if (blocked || store.restoring) {
      return;
    }
    if (store.requestRestore()) {
      setConfirmOpen(true);
    }
  };

  const statusTone =
    outcome?.status === "applied"
      ? "success"
      : outcome?.status === "skipped"
        ? "warning"
        : "neutral";

  return (
    <div className="backup-restore">
      <h3>{t("backup.restoreTitle")}</h3>
      <p className="muted small">{t("backup.restoreHint")}</p>

      <div className="form-grid backup-form">
        <Field
          id="backup-restore-file"
          label={t("backup.restore.fileLabel")}
          hint={t("backup.restore.fileHint")}
        >
          <div className="backup-out-row">
            <Input
              id="backup-restore-file"
              readOnly
              value={store.restoreFile ?? ""}
              placeholder={t("backup.restore.noFile")}
              aria-describedby="backup-restore-file-hint"
            />
            <Button
              variant="secondary"
              loading={picking}
              disabled={blocked || picking || store.restoring}
              onClick={() => void pick()}
            >
              {t("backup.restore.pick")}
            </Button>
          </div>
        </Field>
      </div>

      <div className="form-actions">
        <Button
          variant="secondary"
          loading={store.planning}
          disabled={blocked || busy || !store.restoreFile}
          onClick={() => void review()}
        >
          {store.planning
            ? t("backup.restore.reviewing")
            : t("backup.restore.review")}
        </Button>
        <Button
          variant="danger"
          loading={store.restoring}
          disabled={blocked || !store.restoreReady || store.restoring}
          onClick={requestRestore}
        >
          {store.restoring
            ? t("backup.restore.applying")
            : t("backup.restore.apply")}
        </Button>
      </div>

      {pickError ? (
        <Notice variant="error">
          <span>{pickError}</span>
        </Notice>
      ) : null}

      {store.restoreError ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              disabled={blocked || busy || !store.restoreFile}
              onClick={() => void review()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("backup.restore.errorTitle")}</strong>
          <span>{appErrorText(store.restoreError)}</span>
          <code className="callback">
            {t("integrations.errorCode", { code: store.restoreError.code })}
          </code>
        </Notice>
      ) : null}

      {store.restoreState === "cancelled" ? (
        <Notice
          variant="info"
          action={
            <Button
              variant="secondary"
              disabled={blocked || busy || !store.restoreFile}
              onClick={() => void review()}
            >
              {t("backup.restore.review")}
            </Button>
          }
        >
          <strong>{t("runStatus.cancelled")}</strong>
          <span>{t("runStatus.restoreCancelledHint")}</span>
        </Notice>
      ) : null}

      {store.planning ? <Loading label={t("backup.restore.reviewing")} /> : null}

      {!plan && store.restoreState === "idle" ? (
        <EmptyState
          title={t("backup.restore.emptyTitle")}
          hint={t("backup.restore.emptyHint")}
        />
      ) : null}

      {plan ? (
        <div className="stack">
          <div className="card-header">
            <h4>{t("backup.restore.planTitle")}</h4>
            {plan.status ? (
              <Badge tone="info">{plan.status}</Badge>
            ) : null}
          </div>

          {plan.summary ? <p>{plan.summary}</p> : null}

          <div className="backup-facts">
            {plan.action ? (
              <div className="backup-fact">
                <span className="muted small">{t("backup.restore.action")}</span>
                <strong>{plan.action}</strong>
              </div>
            ) : null}
            {plan.target ? (
              <div className="backup-fact">
                <span className="muted small">{t("backup.restore.target")}</span>
                <code>{plan.target}</code>
              </div>
            ) : null}
            {plan.planHash ? (
              <div className="backup-fact">
                <span className="muted small">{t("backup.restore.planHash")}</span>
                <code>{plan.planHash}</code>
              </div>
            ) : null}
          </div>

          {plan.details.length ? (
            <>
              <h4>{t("backup.restore.details")}</h4>
              <DetailTable
                caption={t("backup.restore.details")}
                keyHeader={t("backup.restore.detailKey")}
                valueHeader={t("backup.restore.detailValue")}
                details={plan.details}
              />
            </>
          ) : null}

          {plan.ttlSeconds ? (
            <p className="muted small">
              {t("backup.restore.tokenTtl", { seconds: plan.ttlSeconds })}
            </p>
          ) : null}

          {!plan.confirmToken ? (
            <Notice variant="info">
              <span>{t("backup.restore.tokenMissing")}</span>
            </Notice>
          ) : null}

          {plan.limitations.length ? (
            <div>
              <h4>{t("backup.limitations")}</h4>
              <ul className="report-notes">
                {plan.limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {outcome ? (
        <div className="stack">
          <div className="card-header">
            <h4>{t("backup.restore.resultTitle")}</h4>
            <Badge tone={statusTone}>
              {t(STATUS_KEYS[outcome.status])}
            </Badge>
          </div>

          <div className="backup-facts">
            {outcome.plan.target ? (
              <div className="backup-fact">
                <span className="muted small">{t("backup.restore.target")}</span>
                <code>{outcome.plan.target}</code>
              </div>
            ) : null}
            {outcome.reason ? (
              <div className="backup-fact">
                <span className="muted small">{t("backup.restore.reason")}</span>
                <strong>{outcome.reason}</strong>
              </div>
            ) : null}
          </div>

          {outcome.details.length ? (
            <>
              <h4>{t("backup.restore.resultDetails")}</h4>
              <DetailTable
                caption={t("backup.restore.resultDetails")}
                keyHeader={t("backup.restore.detailKey")}
                valueHeader={t("backup.restore.detailValue")}
                details={outcome.details}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {warnings.length ? (
        <div>
          <h4>{t("backup.warnings")}</h4>
          <ul className="report-notes">
            {warnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("backup.restore.confirmTitle")}
        confirmLabel={t("backup.restore.confirmAction")}
        cancelLabel={t("common.cancel")}
        danger
        busy={store.restoring}
        onCancel={() => {
          setConfirmOpen(false);
          store.cancelRestore();
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void store.confirmRestore(configPath).then((applied) => {
            if (applied) {
              onRestored?.();
            }
          });
        }}
      >
        <p>{t("backup.restore.confirmBody")}</p>
        {plan?.summary ? <p>{plan.summary}</p> : null}
        {plan?.target ? (
          <p>
            <code>{plan.target}</code>
          </p>
        ) : null}
        {store.restoreFile ? (
          <p>
            <code>{store.restoreFile}</code>
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
});
