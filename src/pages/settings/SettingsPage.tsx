import { useEffect, useRef, useState, type ReactNode } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import {
  appErrorText,
  errorCodeKey,
  toAppError,
  type AppError,
} from "@/shared/lib/errors";
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
import {
  openPath,
  type AuthProvider,
  type AuthProviderStatus,
  type ProvidersConfig,
  type PsiStrategy,
  type ReportLocale,
} from "@/entities/config";
import { pickConfig } from "@/entities/engine/api/shell";
import { SaveConfigBar } from "@/features/save-config";
import { UpdatePanel } from "@/features/update";
import {
  SecretModal,
  SecretStore,
  secretPresence,
  secretSourceKey,
} from "@/features/secret-set";

const INIT_COMMAND = "lv24-seo init --property https://example.com --data-dir ./data";

function numberText(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function listText(values: readonly string[]): string {
  return values.join("\n");
}

function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parentPath(path: string | null): string | null {
  if (!path) {
    return null;
  }
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index > 0 ? path.slice(0, index) : null;
}

export const SettingsPage = observer(function SettingsPage() {
  const { t } = useI18n();
  const { engine, config } = useRootStore();
  const { notify } = useFeedback();
  const [secrets] = useState(() => new SecretStore());
  const [secretProvider, setSecretProvider] = useState<AuthProvider | null>(null);
  const secretsPath = useRef<string | null>(null);
  const configPath = engine.status?.configPath ?? null;

  useEffect(() => {
    if (!configPath) {
      // A transient offline status must not make the next status for the same
      // path look like a cache hit: force a fresh token read on recovery.
      secretsPath.current = null;
      return;
    }
    // Only reload when the active path changed; an unsaved draft must survive
    // navigation to Config and back. The secrets store stays page-local.
    if (config.path !== configPath) {
      void config.load(configPath);
    }
    if (secretsPath.current !== configPath) {
      secretsPath.current = configPath;
      void secrets.load(configPath);
    }
  }, [configPath, config, secrets]);

  const draft = config.draft;
  // The effect below updates this ref after paint. Gate the badges on the ref
  // so a workspace switch cannot show the previous workspace's token presence
  // for one frame before the new auth status starts loading.
  const secretsForPath = secretsPath.current === configPath;
  const secretEntries = secretsForPath ? secrets.entries : [];
  const warnings = [
    ...new Set([
      ...config.warnings,
      ...config.parseWarnings,
      ...config.validationWarnings.map((issue) =>
        issue.messageKey ? t(issue.messageKey, issue.params) : issue.message,
      ),
    ]),
  ].filter((item) => item.trim());
  const errorFor = (path: string): string | undefined => {
    const issue = config.fieldError(path);
    if (!issue) {
      return undefined;
    }
    return issue.messageKey ? t(issue.messageKey, issue.params) : issue.message;
  };
  const warningFor = (path: string): string | undefined => {
    const issue = config.fieldWarning(path);
    if (!issue) {
      return undefined;
    }
    return issue.messageKey ? t(issue.messageKey, issue.params) : issue.message;
  };
  const describedBy = (id: string, path: string): string | undefined => {
    const ids: string[] = [];
    if (config.fieldError(path) || config.fieldWarning(path)) {
      ids.push(`${id}-hint`);
    }
    if (config.fieldError(path)) {
      ids.push(`${id}-error`);
    }
    return ids.length ? ids.join(" ") : undefined;
  };

  const set = (path: string, value: unknown) => config.set(path, value);

  const reload = async () => {
    if (!configPath) {
      return;
    }
    const ok = await config.reload();
    // A workspace switch while this reload was in flight already started a
    // newer load; do not overwrite its token status or show a stale toast.
    if (config.path !== configPath) {
      return;
    }
    await secrets.load(configPath);
    notify(
      ok ? t("settings.reloaded") : config.loadError?.message ?? t("settings.loadError"),
      ok ? "success" : "error",
    );
  };

  const validate = async () => {
    const outcome = await config.validate();
    if (outcome === "skipped" || config.path !== configPath) {
      // A parallel call (double click) or a workspace switch: no answer for
      // this draft, so no toast that would claim it is invalid.
      return;
    }
    notify(
      outcome === "valid"
        ? t("settings.validation.valid")
        : t("settings.validation.invalid"),
      outcome === "valid" ? "success" : "error",
    );
  };

  const saveErrorText = (error: AppError | null): string | undefined => {
    if (!error) {
      return undefined;
    }
    if (error.code === "CONFIG_NOTHING_TO_WRITE") {
      return t("settings.nothingToWrite");
    }
    const key = errorCodeKey(error.code);
    return key ? t(key) : appErrorText(error);
  };

  const save = async () => {
    const ok = await config.save();
    if (config.path !== configPath) {
      return;
    }
    notify(
      ok ? t("settings.saved") : saveErrorText(config.saveError) ?? t("settings.saveFailed"),
      ok ? "success" : "error",
    );
  };

  const discard = () => {
    config.discard();
    notify(t("settings.discarded"));
  };

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

  const openSecret = (provider: AuthProvider) => setSecretProvider(provider);

  const tokenBadge = (provider: AuthProvider) => {
    const known = secretsForPath && secrets.state === "ready";
    const status: AuthProviderStatus | undefined = known
      ? secretEntries.find((entry) => entry.provider === provider)
      : undefined;
    const presence = secretPresence(known ? secretEntries : [], provider);
    return (
      <div className="badge-row">
        <Badge
          tone={
            presence === "present"
              ? "success"
              : presence === "missing"
                ? "warning"
                : "neutral"
          }
        >
          {presence === "present"
            ? t("secrets.present")
            : presence === "missing"
              ? t("secrets.missing")
              : t("secrets.unknown")}
        </Badge>
        {status ? (
          <span className="muted small">
            {t("secrets.source")}: {t(secretSourceKey(status.source))}
          </span>
        ) : null}
        <Button variant="link" onClick={() => openSecret(provider)}>
          {t("settings.providers.setToken")}
        </Button>
      </div>
    );
  };

  const reserved = (key: MessageKey, value: string) => (
    <div className="field">
      <span>{t(key)}</span>
      <div className="badge-row">
        <Badge tone="neutral">{t("settings.reserved.noEffect")}</Badge>
        <code>{value}</code>
      </div>
      <small>{t("settings.reserved.hint")}</small>
    </div>
  );

  /**
   * One provider block with an explicit enable/disable toggle. The toggle is
   * the only place that writes `providers.<id>.present`: a disabled block is
   * removed from seo.toml on save, and its fields stay out of reach.
   */
  const providerBlock = (
    provider: keyof ProvidersConfig,
    labelKey: MessageKey,
    fields: ReactNode,
  ) => {
    const present = draft?.providers[provider].present ?? false;
    const label = t(labelKey);
    return (
      <div className="provider-block" key={provider}>
        <div className="provider-block-head">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={present}
              aria-label={t("settings.providers.toggle", { provider: label })}
              onChange={(event) =>
                set(`providers.${provider}.present`, event.target.checked)
              }
            />
            <span>{label}</span>
          </label>
          <Badge tone={present ? "success" : "neutral"}>
            {present
              ? t("settings.providers.enabled")
              : t("settings.providers.disabled")}
          </Badge>
        </div>
        {present ? (
          <div className="form-grid">{fields}</div>
        ) : (
          <p className="muted small">{t("settings.providers.disabledHint")}</p>
        )}
      </div>
    );
  };

  const chooseConfig = async () => {
    try {
      // SEC-05: the shell owns the native dialog and persists the path, so the
      // webview cannot point config_write/config_patch at an arbitrary file.
      const selected = await pickConfig();
      if (!selected) {
        return;
      }
      await engine.load();
      // The picker persists the path, but the shell can still fail to load it.
      // Do not report a successful workspace switch when status disagrees.
      if (engine.status?.configPath !== selected) {
        notify(t("settings.chooseConfigFailed"), "error");
        return;
      }
      notify(t("settings.configSelected"), "success");
    } catch (error) {
      notify(toAppError(error, "PICK_CONFIG").message, "error");
    }
  };

  const header = (
    <header className="page-header">
      <div>
        <h1>{t("settings.title")}</h1>
        <p className="muted">{t("settings.subtitle")}</p>
      </div>
      <div className="page-actions">
        <Button variant="secondary" onClick={() => void chooseConfig()}>
          {configPath ? t("settings.changeConfig") : t("settings.chooseConfig")}
        </Button>
        <Button
          variant="secondary"
          loading={config.loading}
          disabled={!configPath}
          onClick={() => void reload()}
        >
          {t("settings.reload")}
        </Button>
        <Button
          variant="secondary"
          loading={config.validating}
          disabled={!config.ready}
          onClick={() => void validate()}
        >
          {t("settings.validate")}
        </Button>
        <Button
          variant="secondary"
          disabled={!configPath}
          onClick={() => void reveal(configPath)}
        >
          {t("settings.reveal")}
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
            title={t("settings.noWorkspaceTitle")}
            hint={t("settings.noWorkspaceHint")}
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
        <UpdatePanel />
      </section>
    );
  }

  return (
    <section className="page">
      {header}

      {engine.offline ? (
        <Notice variant="info">
          <strong>{t("settings.offlineTitle")}</strong>
          <span>{t("settings.offlineHint")}</span>
        </Notice>
      ) : null}

      {config.loading && !draft ? <Loading label={t("settings.loading")} /> : null}

      {config.loadError ? (
        <Notice
          variant="error"
          action={
            <Button variant="secondary" onClick={() => void reload()}>
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("settings.loadError")}</strong>
          <span>{config.loadError.message}</span>
        </Notice>
      ) : null}

      {config.engineError ? (
        <Notice variant="error">
          <strong>{t("settings.engineError")}</strong>
          <span>{config.engineError.message}</span>
        </Notice>
      ) : null}

      {secretsForPath && secrets.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void secrets.load(configPath)}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("settings.tokensError")}</strong>
          <span>{secrets.error.message}</span>
        </Notice>
      ) : null}

      {config.unknownKeys.length ? (
        <Notice variant="info">
          <strong>{t("settings.unknownKeys")}</strong>
          <span>{t("settings.unknownKeysHint")}</span>
          <code className="callback">{config.unknownKeys.join(", ")}</code>
        </Notice>
      ) : null}

      {config.parseWarnings.length ? (
        <Notice variant="info">
          <strong>{t("settings.parseWarning")}</strong>
          <ul className="service-list">
            {config.parseWarnings.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {config.validation && !config.validation.valid ? (
        <Notice variant="error">
          <strong>{t("settings.validation.invalid")}</strong>
          <span>
            {config.validation.engineMessage ?? t("settings.validation.fixFields")}
          </span>
        </Notice>
      ) : null}

      {config.saveError ? (
        <Notice variant="error">
          <strong>{t("settings.saveFailed")}</strong>
          <span>{saveErrorText(config.saveError)}</span>
        </Notice>
      ) : null}

      {config.usedFullWrite ? (
        <Notice variant="info">
          <span>{t("settings.fullWriteWarning")}</span>
        </Notice>
      ) : null}

      {config.lastBackup ? (
        <Notice variant="info">
          <strong>{t("settings.backupCreated")}</strong>
          <code className="callback">{config.lastBackup}</code>
        </Notice>
      ) : null}

      {draft ? (
        <>
          <Card>
            <div className="card-header">
              <div>
                <h2>{t("settings.sections.project")}</h2>
                <p className="muted small">{t("settings.sections.projectHint")}</p>
              </div>
              <Button
                variant="link"
                onClick={() => void reveal(parentPath(configPath))}
              >
                {t("settings.openConfigFolder")}
              </Button>
            </div>
            <div className="form-grid">
              <Field id="project-name" label={t("settings.project.name")}>
                <Input
                  id="project-name"
                  value={draft.project.name}
                  onChange={(event) => set("project.name", event.target.value)}
                />
              </Field>
              <Field
                id="project-base-url"
                label={t("settings.project.baseUrl")}
                hint={t("settings.project.baseUrlHint")}
                error={errorFor("project.base_url")}
              >
                <Input
                  id="project-base-url"
                  type="url"
                  value={draft.project.base_url}
                  aria-invalid={Boolean(errorFor("project.base_url"))}
                  aria-describedby={describedBy("project-base-url", "project.base_url")}
                  onChange={(event) => set("project.base_url", event.target.value)}
                />
              </Field>
              <Field
                id="project-property"
                label={t("settings.project.defaultProperty")}
                hint={t("settings.project.defaultPropertyHint")}
              >
                <Input
                  id="project-property"
                  value={draft.project.default_property}
                  onChange={(event) =>
                    set("project.default_property", event.target.value)
                  }
                />
              </Field>
              <Field
                id="storage-data-dir"
                label={t("settings.project.dataDir")}
                hint={t("settings.project.dataDirHint")}
                error={errorFor("storage.data_dir")}
              >
                <Input
                  id="storage-data-dir"
                  value={draft.storage.data_dir}
                  aria-invalid={Boolean(errorFor("storage.data_dir"))}
                  aria-describedby={describedBy("storage-data-dir", "storage.data_dir")}
                  onChange={(event) => set("storage.data_dir", event.target.value)}
                />
              </Field>
              {reserved(
                "settings.reserved.rawRetention",
                String(draft.storage.raw_retention_days),
              )}
            </div>
          </Card>

          <Card>
            <div className="card-header">
              <div>
                <h2>{t("settings.sections.providers")}</h2>
                <p className="muted small">{t("settings.sections.providersHint")}</p>
              </div>
              <Button
                variant="secondary"
                loading={secrets.loading}
                onClick={() => void secrets.load(configPath)}
              >
                {t("settings.providers.refreshTokens")}
              </Button>
            </div>
            <div className="stack">
              {providerBlock(
                "gsc",
                "secrets.provider.gsc",
                <>
                  <Field
                    id="provider-gsc-property"
                    label={t("settings.providers.property")}
                    hint={t("settings.providers.propertyHint")}
                  >
                    <Input
                      id="provider-gsc-property"
                      value={draft.providers.gsc.property}
                      onChange={(event) =>
                        set("providers.gsc.property", event.target.value)
                      }
                    />
                    {tokenBadge("gsc")}
                  </Field>
                  {reserved("settings.reserved.gscAuth", draft.providers.gsc.auth)}
                </>,
              )}
              {providerBlock(
                "yandex_webmaster",
                "secrets.provider.yandex",
                <Field
                  id="provider-yandex-host"
                  label={t("settings.providers.hostId")}
                  hint={t("settings.providers.hostIdHint")}
                >
                  <Input
                    id="provider-yandex-host"
                    value={draft.providers.yandex_webmaster.host_id}
                    onChange={(event) =>
                      set("providers.yandex_webmaster.host_id", event.target.value)
                    }
                  />
                  {tokenBadge("yandex")}
                </Field>,
              )}
              {providerBlock(
                "yandex_metrika",
                "secrets.provider.metrika",
                <>
                  <Field
                    id="provider-metrika-counter"
                    label={t("settings.providers.counter")}
                    hint={t("settings.providers.counterHint")}
                  >
                    <Input
                      id="provider-metrika-counter"
                      value={draft.providers.yandex_metrika.counter}
                      onChange={(event) =>
                        set("providers.yandex_metrika.counter", event.target.value)
                      }
                    />
                    {tokenBadge("metrika")}
                  </Field>
                  {reserved(
                    "settings.reserved.metrikaGoals",
                    draft.providers.yandex_metrika.goals.join(", ") || "—",
                  )}
                </>,
              )}
              {providerBlock(
                "bing",
                "secrets.provider.bing",
                <Field
                  id="provider-bing-site"
                  label={t("settings.providers.site")}
                  hint={t("settings.providers.siteHint")}
                >
                  <Input
                    id="provider-bing-site"
                    value={draft.providers.bing.site}
                    onChange={(event) =>
                      set("providers.bing.site", event.target.value)
                    }
                  />
                  {tokenBadge("bing")}
                </Field>,
              )}
              {providerBlock(
                "crux",
                "secrets.provider.crux",
                <Field
                  id="provider-crux-origin"
                  label={t("settings.providers.origin")}
                  hint={t("settings.providers.originHint")}
                >
                  <Input
                    id="provider-crux-origin"
                    value={draft.providers.crux.origin}
                    onChange={(event) =>
                      set("providers.crux.origin", event.target.value)
                    }
                  />
                  {tokenBadge("crux")}
                </Field>,
              )}
              {providerBlock(
                "psi",
                "secrets.provider.psi",
                <>
                  <Field
                    id="provider-psi-strategy"
                    label={t("settings.providers.strategy")}
                    error={errorFor("providers.psi.strategy")}
                  >
                    <Select
                      id="provider-psi-strategy"
                      value={draft.providers.psi.strategy}
                      onChange={(event) =>
                        set(
                          "providers.psi.strategy",
                          event.target.value as PsiStrategy,
                        )
                      }
                    >
                      <option value="mobile">
                        {t("settings.providers.strategyMobile")}
                      </option>
                      <option value="desktop">
                        {t("settings.providers.strategyDesktop")}
                      </option>
                    </Select>
                    {tokenBadge("psi")}
                  </Field>
                  <Field
                    id="provider-psi-urls"
                    label={t("settings.providers.urls")}
                    hint={t("settings.providers.urlsHint")}
                  >
                    <textarea
                      id="provider-psi-urls"
                      className="input"
                      rows={4}
                      value={listText(draft.providers.psi.urls)}
                      aria-describedby={describedBy("provider-psi-urls", "providers.psi.urls")}
                      onChange={(event) =>
                        set("providers.psi.urls", parseList(event.target.value))
                      }
                    />
                    {warningFor("providers.psi.urls") ? (
                      <small className="muted">
                        {warningFor("providers.psi.urls")}
                      </small>
                    ) : null}
                  </Field>
                </>,
              )}
            </div>
          </Card>

          <Card>
            <h2>{t("settings.sections.report")}</h2>
            <div className="form-grid">
              <Field
                id="report-locale"
                label={t("settings.report.locale")}
                hint={t("settings.report.localeHint")}
                error={errorFor("report.locale")}
              >
                <Select
                  id="report-locale"
                  value={draft.report.locale}
                  aria-invalid={Boolean(errorFor("report.locale"))}
                  onChange={(event) =>
                    set("report.locale", event.target.value as ReportLocale)
                  }
                >
                  <option value="ru">{t("settings.report.localeRu")}</option>
                  <option value="en">{t("settings.report.localeEn")}</option>
                  <option value="zh">{t("settings.report.localeZh")}</option>
                </Select>
              </Field>
              <Field
                id="report-timezone"
                label={t("settings.report.timezone")}
                hint={t("settings.report.timezoneHint")}
                error={errorFor("report.timezone")}
              >
                <Input
                  id="report-timezone"
                  value={draft.report.timezone}
                  aria-invalid={Boolean(errorFor("report.timezone"))}
                  aria-describedby={describedBy("report-timezone", "report.timezone")}
                  onChange={(event) => set("report.timezone", event.target.value)}
                />
              </Field>
              <Field
                id="threshold-clicks"
                label={t("settings.report.clicksPct")}
                error={errorFor("report.thresholds.clicks_pct")}
              >
                <Input
                  id="threshold-clicks"
                  type="number"
                  min={0}
                  step="0.1"
                  value={numberText(draft.report.thresholds.clicks_pct)}
                  aria-invalid={Boolean(errorFor("report.thresholds.clicks_pct"))}
                  onChange={(event) =>
                    set("report.thresholds.clicks_pct", Number(event.target.value))
                  }
                />
              </Field>
              <Field
                id="threshold-impressions"
                label={t("settings.report.impressionsPct")}
                error={errorFor("report.thresholds.impressions_pct")}
              >
                <Input
                  id="threshold-impressions"
                  type="number"
                  min={0}
                  step="0.1"
                  value={numberText(draft.report.thresholds.impressions_pct)}
                  aria-invalid={Boolean(
                    errorFor("report.thresholds.impressions_pct"),
                  )}
                  onChange={(event) =>
                    set(
                      "report.thresholds.impressions_pct",
                      Number(event.target.value),
                    )
                  }
                />
              </Field>
              <Field
                id="threshold-position"
                label={t("settings.report.positionAbs")}
                error={errorFor("report.thresholds.position_abs")}
              >
                <Input
                  id="threshold-position"
                  type="number"
                  min={0}
                  step="0.1"
                  value={numberText(draft.report.thresholds.position_abs)}
                  aria-invalid={Boolean(errorFor("report.thresholds.position_abs"))}
                  onChange={(event) =>
                    set("report.thresholds.position_abs", Number(event.target.value))
                  }
                />
              </Field>
              {reserved("settings.reserved.weekStart", draft.report.week_start)}
            </div>
          </Card>

          <Card>
            <h2>{t("settings.sections.email")}</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.report.email.enabled}
                onChange={(event) =>
                  set("report.email.enabled", event.target.checked)
                }
              />
              <span>{t("settings.email.enabled")}</span>
            </label>
            <div className="form-grid">
              <Field
                id="email-to"
                label={t("settings.email.to")}
                hint={t("settings.email.toHint")}
              >
                <textarea
                  id="email-to"
                  className="input"
                  rows={3}
                  value={listText(draft.report.email.to)}
                  onChange={(event) =>
                    set("report.email.to", parseList(event.target.value))
                  }
                />
                {warningFor("report.email.to") ? (
                  <small className="muted">{warningFor("report.email.to")}</small>
                ) : null}
              </Field>
              <Field id="email-from" label={t("settings.email.from")}>
                <Input
                  id="email-from"
                  type="email"
                  value={draft.report.email.from}
                  onChange={(event) =>
                    set("report.email.from", event.target.value)
                  }
                />
                {warningFor("report.email.from") ? (
                  <small className="muted">
                    {warningFor("report.email.from")}
                  </small>
                ) : null}
              </Field>
              <Field id="email-host" label={t("settings.email.host")}>
                <Input
                  id="email-host"
                  value={draft.report.email.smtp_host}
                  onChange={(event) =>
                    set("report.email.smtp_host", event.target.value)
                  }
                />
                {tokenBadge("smtp")}
                {warningFor("report.email.smtp_host") ? (
                  <small className="muted">
                    {warningFor("report.email.smtp_host")}
                  </small>
                ) : null}
              </Field>
              <Field
                id="email-port"
                label={t("settings.email.port")}
                error={errorFor("report.email.smtp_port")}
              >
                <Input
                  id="email-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={numberText(draft.report.email.smtp_port)}
                  aria-invalid={Boolean(errorFor("report.email.smtp_port"))}
                  onChange={(event) =>
                    set("report.email.smtp_port", Number(event.target.value))
                  }
                />
              </Field>
              <Field id="email-user" label={t("settings.email.user")}>
                <Input
                  id="email-user"
                  value={draft.report.email.smtp_user}
                  onChange={(event) =>
                    set("report.email.smtp_user", event.target.value)
                  }
                />
              </Field>
              <div className="field">
                <span>{t("settings.email.onlyOnChange")}</span>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.report.email.only_on_change}
                    onChange={(event) =>
                      set("report.email.only_on_change", event.target.checked)
                    }
                  />
                  <span>{t("settings.email.onlyOnChangeHint")}</span>
                </label>
              </div>
            </div>
          </Card>

          <Card>
            <h2>{t("settings.sections.telegram")}</h2>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.report.telegram.enabled}
                onChange={(event) =>
                  set("report.telegram.enabled", event.target.checked)
                }
              />
              <span>{t("settings.telegram.enabled")}</span>
            </label>
            <div className="form-grid">
              <Field id="telegram-chat" label={t("settings.telegram.chatId")}>
                <Input
                  id="telegram-chat"
                  value={draft.report.telegram.chat_id}
                  onChange={(event) =>
                    set("report.telegram.chat_id", event.target.value)
                  }
                />
                {tokenBadge("telegram")}
                {warningFor("report.telegram.chat_id") ? (
                  <small className="muted">
                    {warningFor("report.telegram.chat_id")}
                  </small>
                ) : null}
              </Field>
              {reserved(
                "settings.reserved.telegramSeverity",
                draft.report.telegram.severity,
              )}
            </div>
          </Card>

          <Card>
            <h2>{t("settings.sections.crawl")}</h2>
            <div className="form-grid">
              <Field
                id="crawl-max-urls"
                label={t("settings.crawl.maxUrls")}
                hint={t("settings.crawl.maxUrlsHint")}
                error={errorFor("crawl.max_urls")}
              >
                <Input
                  id="crawl-max-urls"
                  type="number"
                  min={1}
                  value={numberText(draft.crawl.max_urls)}
                  aria-invalid={Boolean(errorFor("crawl.max_urls"))}
                  onChange={(event) =>
                    set("crawl.max_urls", Number(event.target.value))
                  }
                />
              </Field>
              <Field
                id="crawl-user-agent"
                label={t("settings.crawl.userAgent")}
                hint={t("settings.crawl.userAgentHint")}
              >
                <Input
                  id="crawl-user-agent"
                  value={draft.crawl.user_agent}
                  onChange={(event) =>
                    set("crawl.user_agent", event.target.value)
                  }
                />
              </Field>
              <div className="field">
                <span>{t("settings.crawl.respectRobots")}</span>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.crawl.respect_robots}
                    onChange={(event) =>
                      set("crawl.respect_robots", event.target.checked)
                    }
                  />
                  <span>{t("settings.crawl.respectRobotsHint")}</span>
                </label>
              </div>
              {reserved(
                "settings.reserved.concurrency",
                String(draft.crawl.concurrency),
              )}
            </div>
          </Card>

          <UpdatePanel />

          {warnings.length ? (
            <Card>
              <h4>{t("settings.warnings")}</h4>
              <ul className="service-list">
                {warnings.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <SaveConfigBar
            dirty={config.dirty}
            saving={config.saving}
            validating={config.validating}
            canSave={config.canSave}
            errorCount={config.errors.length}
            warningCount={config.validationWarnings.length}
            lastBackup={config.lastBackup}
            onSave={() => void save()}
            onDiscard={discard}
            onValidate={() => void validate()}
          />
        </>
      ) : null}

      <SecretModal
        open={secretProvider !== null}
        provider={secretProvider}
        entries={secretEntries}
        configPath={configPath}
        onClose={() => setSecretProvider(null)}
        onChanged={() => void secrets.load(configPath)}
      />
    </section>
  );
});
