import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
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
import { CopyButton } from "@/entities/config";
import {
  SCHEDULE_TARGETS,
  cronIssueKey,
  cronIssueParams,
  formatScheduleArtifact,
  type ScheduleTarget,
} from "@/entities/integrations";
import { ScheduleInstallPanel } from "./ScheduleInstallPanel";

const TARGET_LABEL_KEYS: Record<ScheduleTarget, MessageKey> = {
  cron: "integrations.schedule.target.cron",
  systemd: "integrations.schedule.target.systemd",
  windows: "integrations.schedule.target.windows",
};

type ScheduleMode = "preview" | "install";

/**
 * Scheduler panel. The default `preview` mode renders the host artifact and
 * installs nothing; `install` mode writes a host job only after the explicit
 * confirmation dialog in `ScheduleInstallPanel`.
 */
export const SchedulePanel = observer(function SchedulePanel() {
  const { t } = useI18n();
  const { engine, schedule: store } = useRootStore();
  const [mode, setMode] = useState<ScheduleMode>("preview");

  const configPath = engine.status?.configPath ?? null;
  const platform = engine.status?.platform ?? null;

  const validation = store.validation;
  const cronError = validation.valid
    ? undefined
    : t(cronIssueKey(validation.issue), cronIssueParams(validation.issue));
  const describedBy = [
    "schedule-cron-hint",
    validation.valid ? null : "schedule-cron-error",
  ]
    .filter(Boolean)
    .join(" ");
  const blocked = engine.offline || !configPath;
  const target = store.resolveTarget(platform);

  const generate = async () => {
    await store.generate(configPath, platform);
  };

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("integrations.schedule.title")}</h2>
          <p className="muted small">{t("integrations.schedule.subtitle")}</p>
        </div>
        <Badge tone={mode === "install" ? "danger" : "warning"}>
          {mode === "install"
            ? t("integrations.schedule.installBadge")
            : t("integrations.schedule.printOnlyBadge")}
        </Badge>
      </div>

      {engine.offline ? (
        <Notice
          variant="info"
          action={
            <Button variant="secondary" onClick={() => void engine.load()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("integrations.schedule.offlineTitle")}</strong>
          <span>{t("integrations.schedule.offlineHint")}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {t("integrations.schedule.openSettings")}
            </Link>
          }
        >
          <strong>{t("integrations.schedule.noWorkspaceTitle")}</strong>
          <span>{t("integrations.schedule.noWorkspaceHint")}</span>
        </Notice>
      ) : null}

      <Field
        id="schedule-mode"
        label={t("integrations.schedule.mode")}
        hint={t("integrations.schedule.modeHint")}
      >
        <Select
          id="schedule-mode"
          value={mode}
          onChange={(event) =>
            setMode(event.target.value === "install" ? "install" : "preview")
          }
        >
          <option value="preview">
            {t("integrations.schedule.modePreview")}
          </option>
          <option value="install">
            {t("integrations.schedule.modeInstall")}
          </option>
        </Select>
      </Field>

      {mode === "preview" ? (
        <>
          <div className="form-grid">
            <Field
              id="schedule-cron"
              label={t("integrations.schedule.cron")}
              hint={t("integrations.schedule.cronHint")}
              error={cronError}
            >
              <Input
                id="schedule-cron"
                value={store.cron}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={!validation.valid}
                aria-describedby={describedBy}
                onChange={(event) => store.setCron(event.target.value)}
              />
            </Field>

            <Field
              id="schedule-target"
              label={t("integrations.schedule.target")}
              hint={t("integrations.schedule.targetHint")}
            >
              <Select
                id="schedule-target"
                value={target}
                onChange={(event) => store.setTarget(event.target.value)}
              >
                {SCHEDULE_TARGETS.map((item) => (
                  <option key={item} value={item}>
                    {t(TARGET_LABEL_KEYS[item])}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Notice variant="info">
            <span>{t("integrations.schedule.printOnlyHint")}</span>
          </Notice>

          <div className="form-actions">
            <Button
              variant="primary"
              loading={store.loading}
              disabled={blocked || !validation.valid}
              onClick={() => void generate()}
            >
              {store.loading
                ? t("integrations.schedule.generating")
                : t("integrations.schedule.generate")}
            </Button>
          </div>

          {store.error ? (
            <Notice
              variant="error"
              action={
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onClick={() => void generate()}
                >
                  {t("common.retry")}
                </Button>
              }
            >
              <strong>{t("integrations.schedule.errorTitle")}</strong>
              <span>{appErrorText(store.error)}</span>
              <code className="callback">
                {t("integrations.errorCode", { code: store.error.code })}
              </code>
            </Notice>
          ) : null}

          {store.loading ? (
            <Loading label={t("integrations.schedule.generating")} />
          ) : null}

          {store.state === "idle" && !blocked ? (
            <EmptyState
              title={t("integrations.schedule.emptyTitle")}
              hint={t("integrations.schedule.emptyHint")}
            />
          ) : null}

          {store.artifact ? (
            <div className="stack">
              <div className="card-header">
                <h3>{t("integrations.schedule.artifactTitle")}</h3>
                <div className="badge-row">
                  {store.artifact.target ? (
                    <Badge tone="neutral">
                      {t("integrations.schedule.targetValue", {
                        target: store.artifact.target,
                      })}
                    </Badge>
                  ) : null}
                  {store.artifact.dryRun ? (
                    <Badge tone="info">
                      {t("integrations.schedule.dryRun")}
                    </Badge>
                  ) : null}
                  <CopyButton
                    value={formatScheduleArtifact(store.artifact)}
                    label={t("integrations.schedule.copyAll")}
                    copiedLabel={t("common.copied")}
                  />
                </div>
              </div>

              {store.artifact.command ? (
                <p className="muted small">
                  {t("integrations.schedule.command", {
                    command: store.artifact.command,
                  })}
                </p>
              ) : null}

              {store.artifact.files.length ? (
                store.artifact.files.map((file) => (
                  <div key={file.name}>
                    <div className="card-header">
                      <h4>
                        <code>{file.name}</code>
                      </h4>
                      <CopyButton
                        value={file.content}
                        label={t("integrations.schedule.copyFile", {
                          name: file.name,
                        })}
                        copiedLabel={t("common.copied")}
                      />
                    </div>
                    <pre className="log-output" tabIndex={0}>
                      {file.content}
                    </pre>
                  </div>
                ))
              ) : (
                <p className="muted">{t("integrations.schedule.noFiles")}</p>
              )}

              <p className="muted small">
                {t("integrations.schedule.artifactHint")}
              </p>
            </div>
          ) : null}

          {store.warnings.length ? (
            <div>
              <h4>{t("integrations.schedule.warnings")}</h4>
              <ul className="service-list">
                {store.warnings.map((warning, index) => (
                  <li key={`${index}-${warning}`}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <ScheduleInstallPanel
          store={store}
          configPath={configPath}
          blocked={blocked}
        />
      )}
    </Card>
  );
});
