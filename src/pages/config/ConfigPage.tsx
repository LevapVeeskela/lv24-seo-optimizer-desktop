import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { appErrorText, toAppError } from "@/shared/lib/errors";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Tabs, type TabItem } from "@/shared/ui/Tabs";
import { useFeedback } from "@/shared/ui/Feedback";
import {
  CopyButton,
  environmentEntries,
  formatDiffValue,
  openPath,
  redactToml,
  type ConfigDiffEntry,
  type EnvironmentStatus,
} from "@/entities/config";
import { pickConfig } from "@/entities/engine/api/shell";

const INIT_COMMAND = "lv24-seo init --property https://example.com --data-dir ./data";

const ENV_STATUS_KEYS: Record<EnvironmentStatus, MessageKey> = {
  detected: "config.environment.detected",
  notDetected: "config.environment.notDetected",
  unknown: "config.environment.unknown",
  secret: "config.environment.secret",
};

function parentPath(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : null;
}

function isAbsolutePath(path: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
}

function resolveDataDir(dataDir: string | null, configPath: string | null): string | null {
  if (!dataDir) {
    return null;
  }
  if (isAbsolutePath(dataDir)) {
    return dataDir;
  }
  const parent = parentPath(configPath);
  if (!parent) {
    return null;
  }
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent}${separator}${dataDir.replace(/^[.][\\/]/, "")}`;
}

function diffKindLabelKey(entry: ConfigDiffEntry): "config.diff.presence" | null {
  return entry.kind === "presence" ? "config.diff.presence" : null;
}

export const ConfigPage = observer(function ConfigPage() {
  const { t, locale } = useI18n();
  const { engine, config } = useRootStore();
  const { notify } = useFeedback();
  const configPath = engine.status?.configPath ?? null;

  useEffect(() => {
    // The store is shared with Settings: keep the draft when the path matches
    // and only load when the active workspace actually changed.
    if (!configPath || config.path === configPath) {
      return;
    }
    void config.load(configPath);
  }, [configPath, config]);

  const reveal = async (path: string | null) => {
    if (!path) {
      return;
    }
    try {
      await openPath(path);
    } catch (error) {
      notify(toAppError(error, "OPEN_PATH").message, "error");
    }
  };

  const chooseConfig = async () => {
    try {
      // SEC-05: the shell owns the dialog and persists the path.
      const selected = await pickConfig();
      if (!selected) {
        return;
      }
      await engine.load();
      if (engine.status?.configPath !== selected) {
        notify(t("settings.chooseConfigFailed"), "error");
        return;
      }
      notify(t("settings.configSelected"), "success");
    } catch (error) {
      notify(toAppError(error, "PICK_CONFIG").message, "error");
    }
  };

  const validate = async () => {
    const outcome = await config.validate();
    if (outcome === "skipped" || config.path !== configPath) {
      return;
    }
    notify(
      outcome === "valid"
        ? t("settings.validation.valid")
        : t("settings.validation.invalid"),
      outcome === "valid" ? "success" : "error",
    );
  };

  const diagnostics = {
    configPath: config.path,
    resolvedPath: config.resolvedPath,
    dataDir: config.dataDir,
    engineVersion: engine.version,
    lastLoadedAt: config.lastLoadedAt,
    lastValidatedAt: config.lastValidatedAt,
    valid: config.validation?.valid ?? null,
    warnings: config.allWarnings,
    unknownKeys: config.unknownKeys,
    backups: config.backups,
  };

  const header = (
    <header className="page-header">
      <div>
        <h1>{t("config.title")}</h1>
        <p className="muted">{t("config.subtitle")}</p>
      </div>
      <div className="page-actions">
        <Button variant="secondary" onClick={() => void chooseConfig()}>
          {configPath ? t("settings.changeConfig") : t("settings.chooseConfig")}
        </Button>
        <Button
          variant="secondary"
          loading={config.loading}
          disabled={!configPath}
          onClick={() => void config.reload()}
        >
          {t("config.reload")}
        </Button>
        <Button
          variant="secondary"
          loading={config.validating}
          disabled={!config.ready}
          onClick={() => void validate()}
        >
          {t("config.validate")}
        </Button>
        <Button
          variant="secondary"
          disabled={!configPath}
          onClick={() => void reveal(configPath)}
        >
          {t("config.openConfig")}
        </Button>
      </div>
    </header>
  );

  if (!configPath && engine.loading) {
    return (
      <section className="page">
        {header}
        <Loading label={t("settings.loading")} />
      </section>
    );
  }

  if (!configPath) {
    return (
      <section className="page">
        {header}
        <Card>
          <EmptyState
            title={t("config.noWorkspaceTitle")}
            hint={t("config.noWorkspaceHint")}
            action={
              <div className="form-actions">
                <Button variant="primary" onClick={() => void chooseConfig()}>
                  {t("settings.chooseConfig")}
                </Button>
                <code className="callback">{INIT_COMMAND}</code>
              </div>
            }
          />
        </Card>
      </section>
    );
  }

  const overview = (
    <div className="stack">
      <Card>
        <div className="card-header">
          <div>
            <h2>{t("config.overview.title")}</h2>
            <p className="muted small">{t("config.overview.hint")}</p>
          </div>
          <div className="badge-row">
            <Badge tone={config.ready ? "success" : "warning"}>
              {config.ready ? t("config.overview.loaded") : t("config.overview.notLoaded")}
            </Badge>
            {config.dirty ? (
              <Badge tone="warning">{t("settings.bar.dirty")}</Badge>
            ) : null}
          </div>
        </div>
        <dl className="details">
          <dt>{t("config.overview.configPath")}</dt>
          <dd><code>{config.path ?? "—"}</code></dd>
          <dt>{t("config.overview.resolvedPath")}</dt>
          <dd><code>{config.resolvedPath ?? "—"}</code></dd>
          <dt>{t("config.overview.dataDir")}</dt>
          <dd><code>{config.dataDir ?? "—"}</code></dd>
          <dt>{t("config.overview.engineVersion")}</dt>
          <dd>{engine.version ?? t("common.notAvailable")}</dd>
          <dt>{t("config.overview.lastLoaded")}</dt>
          <dd>{config.lastLoadedAt ? formatDateTime(config.lastLoadedAt, locale) : "—"}</dd>
          <dt>{t("config.overview.lastValidated")}</dt>
          <dd>
            {config.lastValidatedAt
              ? formatDateTime(config.lastValidatedAt, locale)
              : t("config.overview.neverValidated")}
          </dd>
          <dt>{t("config.overview.sourceSize")}</dt>
          <dd>{t("config.overview.characters", { count: config.raw.length })}</dd>
          <dt>{t("config.overview.effectiveKeys")}</dt>
          <dd>{Object.keys(config.effective ?? {}).length}</dd>
        </dl>
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={!config.path}
            onClick={() => void reveal(config.path)}
          >
            {t("config.openConfig")}
          </Button>
          <Button
            variant="secondary"
            disabled={!config.path}
            onClick={() => void reveal(parentPath(config.path))}
          >
            {t("config.openFolder")}
          </Button>
          <Button
            variant="secondary"
            disabled={!resolveDataDir(config.dataDir, config.path)}
            onClick={() =>
              void reveal(resolveDataDir(config.dataDir, config.path))
            }
          >
            {t("config.openDataDir")}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="card-header">
          <div>
            <h2>{t("config.diagnostics.title")}</h2>
            <p className="muted small">{t("config.diagnostics.hint")}</p>
          </div>
          <CopyButton
            value={JSON.stringify(diagnostics, null, 2)}
            label={t("config.diagnostics.copy")}
            copiedLabel={t("common.copied")}
          />
        </div>
        <div className="badge-row">
          <Badge tone={engine.offline ? "danger" : "success"}>
            {engine.offline ? t("engine.offline") : t("engine.online")}
          </Badge>
          {config.validation ? (
            <Badge tone={config.validation.valid ? "success" : "danger"}>
              {config.validation.valid
                ? t("settings.validation.valid")
                : t("settings.validation.invalid")}
            </Badge>
          ) : (
            <Badge tone="neutral">{t("config.overview.neverValidated")}</Badge>
          )}
          {config.engineError ? (
            <Badge tone="danger">{config.engineError.code}</Badge>
          ) : null}
        </div>
        {config.allWarnings.length ? (
          <ul className="service-list">
            {config.allWarnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("config.diagnostics.noWarnings")}</p>
        )}
        {config.backups.length ? (
          <>
            <h4>{t("config.overview.backups")}</h4>
            <ul className="secret-list">
              {config.backups.map((item) => (
                <li key={item}><code>{item}</code></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">{t("config.overview.noBackups")}</p>
        )}
      </Card>
    </div>
  );

  const effective = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.effective.title")}</h2>
          <p className="muted small">{t("config.effective.hint")}</p>
        </div>
        <div className="badge-row">
          <Badge tone="info">{t("config.effective.redacted")}</Badge>
          <CopyButton
            value={config.effectiveJson}
            label={t("common.copy")}
            copiedLabel={t("common.copied")}
          />
        </div>
      </div>
      <pre className="log-output">{config.effectiveJson}</pre>
    </Card>
  );

  const sourceText = redactToml(config.raw);
  const source = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.source.title")}</h2>
          <p className="muted small">{t("config.source.hint")}</p>
        </div>
        <CopyButton
          value={sourceText}
          label={t("common.copy")}
          copiedLabel={t("common.copied")}
        />
      </div>
      <pre className="log-output">{sourceText}</pre>
    </Card>
  );

  const diff = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.diff.title")}</h2>
          <p className="muted small">{t("config.diff.hint")}</p>
        </div>
        <Badge tone={config.diff.length ? "warning" : "success"}>
          {config.diff.length
            ? t("config.diff.count", { count: config.diff.length })
            : t("config.diff.empty")}
        </Badge>
      </div>
      {config.diff.length ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t("config.diff.field")}</th>
                <th>{t("config.diff.saved")}</th>
                <th>{t("config.diff.draft")}</th>
                <th>{t("config.diff.flags")}</th>
              </tr>
            </thead>
            <tbody>
              {config.diff.map((entry) => {
                const kind = diffKindLabelKey(entry);
                return (
                  <tr key={entry.path}>
                    <td data-label={t("config.diff.field")}><code>{entry.path}</code></td>
                    <td data-label={t("config.diff.saved")}>{formatDiffValue(entry.saved)}</td>
                    <td data-label={t("config.diff.draft")}>{formatDiffValue(entry.draft)}</td>
                    <td data-label={t("config.diff.flags")}>
                      <div className="badge-row">
                        {kind ? <Badge tone="neutral">{t(kind)}</Badge> : null}
                        {entry.reserved ? (
                          <Badge tone="warning">{t("settings.reserved.noEffect")}</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title={t("config.diff.emptyTitle")} hint={t("config.diff.emptyHint")} />
      )}
    </Card>
  );

  const validation = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.validation.title")}</h2>
          <p className="muted small">{t("config.validation.hint")}</p>
        </div>
        <Button
          variant="primary"
          loading={config.validating}
          disabled={!config.ready}
          onClick={() => void validate()}
        >
          {config.validating
            ? t("config.validation.running")
            : t("config.validation.run")}
        </Button>
      </div>
      {config.validation ? (
        <div className="stack">
          <div className="badge-row">
            <Badge tone={config.validation.valid ? "success" : "danger"}>
              {config.validation.valid
                ? t("settings.validation.valid")
                : t("settings.validation.invalid")}
            </Badge>
            <span className="muted small">
              {t("config.validation.checkedAt", {
                value: formatDateTime(config.validation.checkedAt, locale),
              })}
            </span>
          </div>
          {config.validation.syntaxError ? (
            <Notice variant="error">
              <strong>{t("config.validation.syntax")}</strong>
              <span>{config.validation.syntaxError}</span>
            </Notice>
          ) : null}
          {config.validation.engineMessage ? (
            <Notice variant="error">
              <strong>{t("config.validation.engineMessage")}</strong>
              <span>{config.validation.engineMessage}</span>
            </Notice>
          ) : null}
          {config.validation.errors.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("config.diff.field")}</th>
                    <th>{t("config.validation.message")}</th>
                  </tr>
                </thead>
                <tbody>
                  {config.validation.errors.map((issue, index) => (
                    <tr key={`${issue.path}-${index}`}>
                      <td data-label={t("config.diff.field")}>
                        <code>{issue.path || "—"}</code>
                      </td>
                      <td data-label={t("config.validation.message")}>
                        {issue.messageKey
                          ? t(issue.messageKey, issue.params)
                          : issue.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">{t("config.validation.noErrors")}</p>
          )}
          {config.validation.warnings.length ? (
            <>
              <h4>{t("settings.validation.warnings")}</h4>
              <ul className="service-list">
                {config.validation.warnings.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}>
                    {issue.messageKey ? t(issue.messageKey, issue.params) : issue.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {config.validation.envelope ? (
            <details>
              <summary>{t("config.validation.envelope")}</summary>
              <pre className="log-output">
                {JSON.stringify(config.validation.envelope, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={t("config.validation.notRunTitle")}
          hint={t("config.validation.notRunHint")}
        />
      )}
    </Card>
  );

  const doctor = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.doctor.title")}</h2>
          <p className="muted small">{t("config.doctor.hint")}</p>
        </div>
        <Button
          variant="primary"
          loading={config.doctorLoading}
          onClick={() => void config.runDoctor()}
        >
          {config.doctorLoading
            ? t("config.doctor.running")
            : t("config.doctor.run")}
        </Button>
      </div>
      {config.doctor ? (
        <div className="stack">
          <div className="badge-row">
            <Badge tone={config.doctor.healthy ? "success" : "danger"}>
              {config.doctor.healthy
                ? t("config.doctor.healthy")
                : t("config.doctor.unhealthy")}
            </Badge>
            <span className="muted small">
              {t("config.doctor.lastRun", {
                value: formatDateTime(config.doctor.ranAt, locale),
              })}
            </span>
          </div>
          {config.doctor.message ? (
            <Notice variant="error"><span>{config.doctor.message}</span></Notice>
          ) : null}
          {config.doctor.checks.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t("config.doctor.check")}</th>
                    <th>{t("config.doctor.status")}</th>
                    <th>{t("config.doctor.detail")}</th>
                  </tr>
                </thead>
                <tbody>
                  {config.doctor.checks.map((check) => (
                    <tr key={check.id}>
                      <td data-label={t("config.doctor.check")}><code>{check.id}</code></td>
                      <td data-label={t("config.doctor.status")}>
                        <Badge tone={check.ok ? "success" : "danger"}>
                          {check.ok ? t("status.ok") : t("status.error")}
                        </Badge>
                      </td>
                      <td data-label={t("config.doctor.detail")}>{check.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted small">{t("config.doctor.noChecks")}</p>
          )}
          {config.doctor.warnings.length ? (
            <ul className="service-list">
              {config.doctor.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={t("config.doctor.notRunTitle")}
          hint={t("config.doctor.notRunHint")}
        />
      )}
    </Card>
  );

  const environment = (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("config.environment.title")}</h2>
          <p className="muted small">{t("config.environment.hint")}</p>
        </div>
        <Badge tone="info">{t("config.environment.noValues")}</Badge>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t("config.environment.name")}</th>
              <th>{t("config.environment.affects")}</th>
              <th>{t("config.environment.status")}</th>
            </tr>
          </thead>
          <tbody>
            {environmentEntries(config.saved, config.effective).map((entry) => (
              <tr key={entry.name}>
                <td data-label={t("config.environment.name")}><code>{entry.name}</code></td>
                <td data-label={t("config.environment.affects")}>
                  {entry.path ? <code>{entry.path}</code> : t("config.environment.noPath")}
                </td>
                <td data-label={t("config.environment.status")}>
                  <Badge
                    tone={
                      entry.status === "detected"
                        ? "warning"
                        : entry.status === "secret"
                          ? "info"
                          : "neutral"
                    }
                  >
                    {t(ENV_STATUS_KEYS[entry.status])}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );

  const items: TabItem[] = [
    { id: "overview", label: t("config.tabs.overview"), content: overview },
    { id: "effective", label: t("config.tabs.effective"), content: effective },
    { id: "source", label: t("config.tabs.source"), content: source },
    { id: "diff", label: t("config.tabs.diff"), content: diff },
    { id: "validation", label: t("config.tabs.validation"), content: validation },
    { id: "doctor", label: t("config.tabs.doctor"), content: doctor },
    { id: "environment", label: t("config.tabs.environment"), content: environment },
  ];

  return (
    <section className="page">
      {header}

      {engine.offline ? (
        <Notice variant="info">
          <strong>{t("settings.offlineTitle")}</strong>
          <span>{t("settings.offlineHint")}</span>
        </Notice>
      ) : null}

      {config.loading && !config.ready ? (
        <Loading label={t("settings.loading")} />
      ) : null}

      {config.loadError ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={() => void config.reload()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("settings.loadError")}</strong>
          <span>{appErrorText(config.loadError)}</span>
        </Notice>
      ) : null}

      {config.engineError ? (
        <Notice variant="error">
          <strong>{t("settings.engineError")}</strong>
          <span>{config.engineError.message}</span>
        </Notice>
      ) : null}

      {config.ready || config.raw || config.loadError ? (
        <Tabs label={t("config.tabs.label")} items={items} />
      ) : null}
    </section>
  );
});
