import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { CopyButton } from "@/entities/config";
import type { AppError } from "@/shared/lib/errors";
import { appErrorText } from "@/shared/lib/errors";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Notice } from "@/shared/ui/Notice";
import type { OnboardingStore } from "../model/OnboardingStore";

const ACTIVATION_CODES = new Set([
  "WORKSPACE_NOT_ACTIVATED",
  "WORKSPACE_ACTIVATE_FAILED",
  "PATH_NOT_APPROVED",
]);

function errorText(error: AppError, t: (key: MessageKey) => string): string {
  if (error.code === "ONBOARDING_CONFIG_EXISTS") {
    return t("onboarding.exists");
  }
  if (error.code === "PATH_NOT_APPROVED") {
    return t("errors.pathNotApproved");
  }
  if (error.code === "WORKSPACE_NOT_ACTIVATED") {
    return t("onboarding.activateFailed");
  }
  return appErrorText(error);
}

export interface OnboardingWizardProps {
  store: OnboardingStore;
  offline: boolean;
  existingConfigPath: string | null;
  dashboardHref: string;
  onCreated: (configPath: string) => void;
}

export const OnboardingWizard = observer(function OnboardingWizard({
  store,
  offline,
  existingConfigPath,
  dashboardHref,
  onCreated,
}: OnboardingWizardProps) {
  const { t } = useI18n();
  const paths = store.paths;
  const siteError = store.siteTouched && store.siteErrorKey
    ? t(store.siteErrorKey)
    : undefined;
  const command = `lv24-seo init --property ${
    store.siteUrl.trim() || "https://example.com"
  } --data-dir ./data`;

  const submit = async () => {
    const created = await store.create();
    if (created) {
      onCreated(created);
    }
  };
  const useExisting = async () => {
    const opened = await store.useExisting();
    if (opened) {
      onCreated(opened);
    }
  };
  const chooseExisting = async () => {
    const opened = await store.chooseExistingConfig();
    if (opened) {
      onCreated(opened);
    }
  };

  const error = store.error;
  const activationError = error ? ACTIVATION_CODES.has(error.code) : false;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("onboarding.title")}</h1>
          <p className="muted">{t("onboarding.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Button
            variant="secondary"
            loading={store.choosing}
            disabled={store.creating}
            onClick={() => void chooseExisting()}
          >
            {t("onboarding.openExisting")}
          </Button>
          <Link className="btn btn-secondary" to={dashboardHref}>
            {t("onboarding.openDashboard")}
          </Link>
        </div>
      </header>

      {offline ? (
        <Notice variant="info">
          <strong>{t("onboarding.offlineTitle")}</strong>
          <span>{t("onboarding.offlineHint")}</span>
        </Notice>
      ) : null}

      {existingConfigPath ? (
        <Notice variant="info">
          <strong>{t("onboarding.existingTitle")}</strong>
          <span>{t("onboarding.existingHint")}</span>
          <code className="callback">{existingConfigPath}</code>
        </Notice>
      ) : null}

      <form
        className="onboarding-steps"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Card>
          <div className="card-header">
            <div>
              <h2>{t("onboarding.step.directory")}</h2>
              <p className="muted small">{t("onboarding.step.directoryHint")}</p>
            </div>
            <Button
              variant="secondary"
              loading={store.choosing}
              disabled={store.creating}
              onClick={() => void store.chooseDirectory()}
            >
              {store.directory
                ? t("onboarding.changeDirectory")
                : t("onboarding.chooseDirectory")}
            </Button>
          </div>
          {store.directory ? (
            <code className="callback">{store.directory}</code>
          ) : (
            <EmptyState title={t("onboarding.noDirectory")} />
          )}
        </Card>

        <Card>
          <h2>{t("onboarding.step.site")}</h2>
          <p className="muted small">{t("onboarding.step.siteHint")}</p>
          <Field
            id="onboarding-site"
            label={t("onboarding.siteLabel")}
            hint={t("onboarding.siteHint")}
            required
            error={siteError}
          >
            <Input
              id="onboarding-site"
              type="text"
              inputMode="url"
              autoComplete="off"
              placeholder={t("onboarding.sitePlaceholder")}
              value={store.siteUrl}
              aria-invalid={Boolean(siteError)}
              aria-describedby={
                siteError
                  ? "onboarding-site-hint onboarding-site-error"
                  : "onboarding-site-hint"
              }
              onChange={(event) => store.setSiteUrl(event.target.value)}
              onBlur={() => store.markSiteTouched()}
            />
          </Field>
        </Card>

        <Card>
          <h2>{t("onboarding.step.summary")}</h2>
          {paths ? (
            <dl className="onboarding-summary">
              <dt>{t("onboarding.configPath")}</dt>
              <dd><code>{paths.configPath}</code></dd>
              <dt>{t("onboarding.dataDir")}</dt>
              <dd><code>{paths.dataDir}</code></dd>
            </dl>
          ) : (
            <p className="muted small">{t("onboarding.noDirectory")}</p>
          )}
        </Card>

        {error ? (
          <Notice
            variant="error"
            action={
              <div className="form-actions">
                {store.exists || store.result ? (
                  <Button variant="secondary" onClick={() => void useExisting()}>
                    {t("onboarding.useExisting")}
                  </Button>
                ) : null}
                {error.code === "PATH_NOT_APPROVED" ? (
                  <Button variant="secondary" onClick={() => void chooseExisting()}>
                    {t("onboarding.chooseCreated")}
                  </Button>
                ) : null}
                {!store.exists &&
                error.code !== "PATH_NOT_APPROVED" &&
                !store.result ? (
                  <Button
                    variant="secondary"
                    loading={store.creating}
                    disabled={!store.canCreate || offline}
                    onClick={() => void submit()}
                  >
                    {t("common.retry")}
                  </Button>
                ) : null}
              </div>
            }
          >
            <strong>
              {activationError
                ? t("onboarding.activateFailed")
                : t("onboarding.createFailed")}
            </strong>
            <span>{errorText(error, t)}</span>
          </Notice>
        ) : null}

        <div className="form-actions">
          <Button
            type="submit"
            variant="primary"
            loading={store.creating}
            disabled={!store.canCreate || offline || Boolean(store.result)}
          >
            {store.creating ? t("onboarding.creating") : t("onboarding.create")}
          </Button>
        </div>
      </form>

      <Card>
        <h2>{t("onboarding.cliTitle")}</h2>
        <p className="muted small">{t("onboarding.cliHint")}</p>
        <code className="callback">{command}</code>
        <div className="form-actions">
          <CopyButton
            value={command}
            label={t("common.copy")}
            copiedLabel={t("common.copied")}
          />
        </div>
      </Card>
    </section>
  );
});
