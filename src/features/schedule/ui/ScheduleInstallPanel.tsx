import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { useI18n } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { Table } from "@/shared/ui/Table";
import {
  cronIssueKey,
  cronIssueParams,
} from "@/entities/integrations";
import {
  SCHEDULE_KINDS,
  type ScheduleKind,
  type ScheduleStore,
} from "../model/ScheduleStore";

export interface ScheduleInstallPanelProps {
  store: ScheduleStore;
  configPath: string | null;
  blocked: boolean;
}

/**
 * Host-scheduler installer. `Install schedule` only opens the confirmation
 * dialog; the engine is called from the dialog's confirm handler. The preview
 * tab remains the default and never writes.
 */
export const ScheduleInstallPanel = observer(function ScheduleInstallPanel({
  store,
  configPath,
  blocked,
}: ScheduleInstallPanelProps) {
  const { t } = useI18n();
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(
    () => () => {
      // Switching back to the preview must not leave a confirmation armed.
      store.cancelInstall();
    },
    [store],
  );

  const validation = store.installCronValidation;
  const cronError = validation.valid
    ? undefined
    : t(cronIssueKey(validation.issue), cronIssueParams(validation.issue));
  const describedBy = [
    "schedule-install-cron-hint",
    validation.valid ? null : "schedule-install-cron-error",
  ]
    .filter(Boolean)
    .join(" ");
  const result = store.installResult;
  const warnings = [
    ...new Set(store.installWarnings.filter((item) => item.trim() !== "")),
  ];

  const requestInstall = () => {
    if (blocked || store.installing) {
      return;
    }
    if (store.requestInstall()) {
      setConfirmOpen(true);
    }
  };

  return (
    <div className="stack">
      <div>
        <h3>{t("integrations.schedule.installTitle")}</h3>
        <p className="muted small">{t("integrations.schedule.installHint")}</p>
      </div>

      <div className="form-grid">
        <Field
          id="schedule-install-kind"
          label={t("integrations.schedule.installKind")}
          hint={t("integrations.schedule.installKindHint")}
        >
          <Select
            id="schedule-install-kind"
            value={store.installKind}
            disabled={store.installing}
            onChange={(event) => store.setInstallKind(event.target.value)}
          >
            {SCHEDULE_KINDS.map((kind: ScheduleKind) => (
              <option key={kind} value={kind}>
                {kind === "weekly"
                  ? t("integrations.schedule.installKindWeekly")
                  : t("integrations.schedule.installKindDaily")}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="schedule-install-cron"
          label={t("integrations.schedule.installCron")}
          hint={t("integrations.schedule.installCronHint")}
          error={cronError}
        >
          <Input
            id="schedule-install-cron"
            value={store.installCron}
            spellCheck={false}
            autoComplete="off"
            disabled={store.installing}
            placeholder={t("integrations.schedule.installCronPlaceholder")}
            aria-invalid={!validation.valid}
            aria-describedby={describedBy}
            onChange={(event) => store.setInstallCron(event.target.value)}
          />
        </Field>
      </div>

      <Notice variant="info">
        <span>{t("integrations.schedule.installConfirmHint")}</span>
      </Notice>

      <div className="form-actions">
        <Button
          variant="danger"
          loading={store.installing}
          disabled={blocked || store.installing || !validation.valid}
          onClick={requestInstall}
        >
          {store.installing
            ? t("integrations.schedule.installing")
            : t("integrations.schedule.installAction")}
        </Button>
      </div>

      {store.installError ? (
        <Notice variant="error">
          <strong>{t("integrations.schedule.installErrorTitle")}</strong>
          <span>{appErrorText(store.installError)}</span>
          <code className="callback">
            {t("integrations.errorCode", { code: store.installError.code })}
          </code>
        </Notice>
      ) : null}

      {store.installing ? (
        <Loading label={t("integrations.schedule.installing")} />
      ) : null}

      {!result && !store.installing && !store.installError ? (
        <EmptyState
          title={t("integrations.schedule.installEmptyTitle")}
          hint={t("integrations.schedule.installEmptyHint")}
        />
      ) : null}

      {result ? (
        <div className="stack">
          <div className="card-header">
            <h4>{t("integrations.schedule.installResultTitle")}</h4>
            <div className="badge-row">
              {result.installed ? (
                <Badge tone="success">
                  {t("integrations.schedule.installInstalled")}
                </Badge>
              ) : null}
              {result.target ? (
                <Badge tone="neutral">
                  {t("integrations.schedule.targetValue", {
                    target: result.target,
                  })}
                </Badge>
              ) : null}
            </div>
          </div>

          {result.command ? (
            <p className="muted small">
              {t("integrations.schedule.command", {
                command: result.command,
              })}
            </p>
          ) : null}

          {result.paths.length ? (
            <>
              <h4>{t("integrations.schedule.installPaths")}</h4>
              <Table caption={t("integrations.schedule.installPaths")}>
                <thead>
                  <tr>
                    <th scope="col">{t("integrations.schedule.installFile")}</th>
                    <th scope="col">{t("integrations.schedule.installPath")}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.paths.map((path) => (
                    <tr key={path.name}>
                      <td>
                        <code>{path.name}</code>
                      </td>
                      <td>
                        <code>{path.content}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}

          {warnings.length ? (
            <div>
              <h4>{t("integrations.schedule.warnings")}</h4>
              <ul className="service-list">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t("integrations.schedule.installConfirmTitle")}
        confirmLabel={t("integrations.schedule.installConfirmAction")}
        cancelLabel={t("common.cancel")}
        danger
        busy={store.installing}
        onCancel={() => {
          setConfirmOpen(false);
          store.cancelInstall();
        }}
        onConfirm={() => {
          setConfirmOpen(false);
          void store.confirmInstall(configPath);
        }}
      >
        <p>
          {t("integrations.schedule.installConfirmBody", {
            kind: store.installKind,
            config: configPath ?? "",
          })}
        </p>
        {store.installCronValue ? (
          <p>
            <code>{store.installCronValue}</code>
          </p>
        ) : (
          <p>{t("integrations.schedule.installConfirmDefaultCron")}</p>
        )}
      </ConfirmDialog>
    </div>
  );
});
