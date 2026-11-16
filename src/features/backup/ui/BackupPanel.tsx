import { useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { CopyButton } from "@/entities/config";
import { useI18n } from "@/shared/i18n";
import { pickDirectory } from "@/shared/desktop/dialog";
import { appErrorText } from "@/shared/lib/errors";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";
import { BackupStore } from "../model/BackupStore";
import { formatBytes } from "../model/format";
import { backupLimitations } from "../model/types";
import "./backup.css";

/**
 * Local backup creator. `backup_create` writes one `.zip` into the folder the
 * user picks; the panel shows the archive path, size and SHA-256 plus the
 * manifest summary, and states plainly that restore is not implemented.
 */
export const BackupPanel = observer(function BackupPanel() {
  const { t, locale } = useI18n();
  const { engine } = useRootStore();
  const [store] = useState(() => new BackupStore());
  const [picking, setPicking] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);

  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

  useEffect(() => {
    // Another workspace has another database; the archive shown belongs to the
    // previous one until the user creates a new backup.
    store.reset();
  }, [configPath, store]);

  const pick = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const directory = await pickDirectory();
      if (directory) {
        store.setOutDir(directory);
      }
    } catch {
      setPickError(t("backup.pickFailed"));
    } finally {
      setPicking(false);
    }
  };

  const submit = async () => {
    if (blocked || store.creating) {
      return;
    }
    await store.run();
  };

  const result = store.result;
  const manifest = result?.manifest ?? null;
  const summary = manifest?.summary ?? null;
  const limitations = backupLimitations(result);
  const warnings = [
    ...new Set(store.warnings.filter((item) => item.trim() !== "")),
  ];

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("backup.title")}</h2>
          <p className="muted small">{t("backup.subtitle")}</p>
        </div>
        <Badge tone="info">{t("backup.localBadge")}</Badge>
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
          <strong>{t("backup.offlineTitle")}</strong>
          <span>{t("backup.offlineHint")}</span>
        </Notice>
      ) : null}

      {!configPath && !engine.loading && !engine.offline ? (
        <Notice
          variant="info"
          action={
            <Link className="btn btn-secondary" to="/settings">
              {t("backup.openSettings")}
            </Link>
          }
        >
          <strong>{t("backup.noWorkspaceTitle")}</strong>
          <span>{t("backup.noWorkspaceHint")}</span>
        </Notice>
      ) : null}

      <div className="form-grid backup-form">
        <Field id="backup-out" label={t("backup.outLabel")} hint={t("backup.outHint")}>
          <div className="backup-out-row">
            <Input
              id="backup-out"
              readOnly
              value={store.outDir ?? ""}
              placeholder={t("backup.noOut")}
              aria-describedby="backup-out-hint"
            />
            <Button
              variant="secondary"
              loading={picking}
              disabled={blocked || picking}
              onClick={() => void pick()}
            >
              {t("backup.pick")}
            </Button>
          </div>
        </Field>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={store.force}
          disabled={blocked || store.creating}
          onChange={(event) => store.setForce(event.target.checked)}
        />
        <span>{t("backup.force")}</span>
      </label>
      <p className="muted small">{t("backup.forceHint")}</p>

      <div className="form-actions">
        <Button
          variant="primary"
          loading={store.creating}
          disabled={blocked || store.creating || !store.outDir}
          onClick={() => void submit()}
        >
          {store.creating ? t("backup.creating") : t("backup.create")}
        </Button>
      </div>

      <Notice variant="info">
        <strong>{t("backup.restoreTitle")}</strong>
        <span>{t("backup.restoreHint")}</span>
      </Notice>

      {pickError ? (
        <Notice variant="error">
          <span>{pickError}</span>
        </Notice>
      ) : null}

      {store.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              disabled={blocked || store.creating || !store.outDir}
              onClick={() => void submit()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("backup.errorTitle")}</strong>
          <span>{appErrorText(store.error)}</span>
          <code className="callback">
            {t("integrations.errorCode", { code: store.error.code })}
          </code>
        </Notice>
      ) : null}

      {store.creating ? <Loading label={t("backup.creating")} /> : null}

      {!result && !store.creating && !store.error ? (
        <EmptyState title={t("backup.emptyTitle")} hint={t("backup.emptyHint")} />
      ) : null}

      {result && manifest ? (
        <div className="stack">
          <h3>{t("backup.archiveTitle")}</h3>

          <div className="backup-facts">
            <div className="backup-fact">
              <span className="muted small">{t("backup.path")}</span>
              <code>{result.archive_path ?? t("common.notAvailable")}</code>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.size")}</span>
              <strong>{formatBytes(result.archive_size, locale)}</strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.sha256")}</span>
              {result.archive_sha256 ? (
                <span className="backup-sha">
                  <code>{result.archive_sha256}</code>
                  <CopyButton
                    value={result.archive_sha256}
                    label={t("backup.copySha")}
                    copiedLabel={t("common.copied")}
                  />
                </span>
              ) : (
                <strong>{t("common.notAvailable")}</strong>
              )}
            </div>
          </div>

          <h3>{t("backup.manifestTitle")}</h3>
          <div className="backup-facts">
            <div className="backup-fact">
              <span className="muted small">{t("backup.createdAt")}</span>
              <strong>
                {formatDateTime(
                  manifest.created_at ?? summary?.created_at ?? null,
                  locale,
                )}
              </strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.engineVersion")}</span>
              <strong>
                {manifest.engine_version ?? summary?.engine_version ?? t("common.notAvailable")}
              </strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.schemaVersion")}</span>
              <strong>
                {formatNumber(
                  manifest.schema_version ?? summary?.schema_version ?? null,
                  locale,
                )}
              </strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.database")}</span>
              <strong>
                {summary?.database_present === true
                  ? t("backup.databasePresent")
                  : summary?.database_present === false
                    ? t("backup.databaseMissing")
                    : t("common.notAvailable")}
              </strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.properties")}</span>
              <strong>{formatNumber(summary?.properties ?? null, locale)}</strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.snapshots")}</span>
              <strong>{formatNumber(summary?.snapshots ?? null, locale)}</strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.latestSnapshot")}</span>
              <strong>
                {formatDateTime(summary?.latest_snapshot_at ?? null, locale)}
              </strong>
            </div>
            <div className="backup-fact">
              <span className="muted small">{t("backup.secrets")}</span>
              <strong>
                {summary?.secrets_included === true
                  ? t("backup.secretsYes")
                  : t("backup.secretsNo")}
              </strong>
            </div>
          </div>

          {manifest.files.length ? (
            <>
              <h4>{t("backup.files")}</h4>
              <Table caption={t("backup.files")} className="backup-files-table">
                <thead>
                  <tr>
                    <th scope="col">{t("backup.fileColumn")}</th>
                    <th scope="col">{t("backup.fileSize")}</th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.files.map((file) => (
                    <tr key={file.path}>
                      <td>
                        <code>{file.path}</code>
                      </td>
                      <td>{formatBytes(file.size, locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          ) : null}

          {limitations.length ? (
            <div>
              <h4>{t("backup.limitations")}</h4>
              <ul className="report-notes">
                {limitations.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
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
        </div>
      ) : null}
    </Card>
  );
});
