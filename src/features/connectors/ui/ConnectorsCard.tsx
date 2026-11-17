import { useEffect, useId, useRef } from "react";
import { observer } from "mobx-react-lite";
import { useI18n, type MessageKey } from "@/shared/i18n";
import type { AppError } from "@/shared/lib/errors";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { InlineError } from "@/shared/ui/InlineError";
import { Notice } from "@/shared/ui/Notice";
import { ENGINE_AUTH_DOCS_URL, YANDEX_VERIFICATION_URL } from "../lib/docs";
import type { OAuthLoginProvider } from "../lib/ipc";
import {
  type ConnectorPresence,
  type ConnectorsStore,
} from "../model/ConnectorsStore";
import "./connectors.css";

const PROVIDERS: ReadonlyArray<{
  id: OAuthLoginProvider;
  label: MessageKey;
  hint: MessageKey;
}> = [
  {
    id: "gsc",
    label: "connectors.provider.gsc",
    hint: "connectors.provider.gsc.hint",
  },
  {
    id: "yandex",
    label: "connectors.provider.yandex",
    hint: "connectors.provider.yandex.hint",
  },
  {
    id: "metrika",
    label: "connectors.provider.metrika",
    hint: "connectors.provider.metrika.hint",
  },
];

function presenceLabel(presence: ConnectorPresence): MessageKey {
  switch (presence) {
    case "connected":
      return "connectors.connected";
    case "not_connected":
      return "connectors.notConnected";
    default:
      return "connectors.unknown";
  }
}

function presenceTone(
  presence: ConnectorPresence,
): "success" | "neutral" | "warning" {
  if (presence === "connected") {
    return "success";
  }
  return presence === "not_connected" ? "warning" : "neutral";
}

function OAuthError({ error }: { error: AppError }) {
  const { t } = useI18n();
  // A missing client id/secret is a setup problem, not a generic failure: the
  // engine's next_action and its auth guide are the actionable parts.
  const needsSetup =
    error.code === "AUTH_REQUIRED" || error.code === "CONFIG_INVALID";
  return (
    <Notice variant="error">
      <strong>{t("connectors.error")}</strong>
      <span>{error.message}</span>
      {error.nextAction ? (
        <code className="callback">{error.nextAction}</code>
      ) : null}
      {needsSetup ? <span>{t("connectors.requiresKey")}</span> : null}
      <a href={ENGINE_AUTH_DOCS_URL} target="_blank" rel="noreferrer">
        {t("connectors.docs")}
      </a>
      <code className="callback">
        {t("integrations.errorCode", { code: error.code })}
      </code>
    </Notice>
  );
}

export const ConnectorsCard = observer(function ConnectorsCard({
  store,
  configPath,
  blocked,
}: {
  store: ConnectorsStore;
  configPath: string | null;
  blocked: boolean;
}) {
  const { t } = useI18n();
  const codeInputId = useId();
  const previousConfig = useRef<string | null>(null);

  useEffect(() => {
    // A code or consent URL belongs to the workspace that requested it; drop
    // the flow when the active config changes, then reload the status.
    if (previousConfig.current !== configPath) {
      store.resetFlow();
      previousConfig.current = configPath;
    }
    if (!blocked) {
      void store.load(configPath);
    }
  }, [store, configPath, blocked]);

  return (
    <Card className="connectors-card" aria-labelledby="connectors-title">
      <div className="card-header">
        <div>
          <h3 id="connectors-title">{t("connectors.title")}</h3>
          <p className="muted small">{t("connectors.subtitle")}</p>
        </div>
        <div className="badge-row">
          <Badge tone="info">{t("connectors.badge")}</Badge>
        </div>
      </div>

      {blocked ? (
        <Notice variant="info">
          <strong>{t("connectors.blockedTitle")}</strong>
          <span>{t("connectors.blockedHint")}</span>
        </Notice>
      ) : null}

      {store.loading ? (
        <p className="muted small" role="status">
          {t("connectors.checking")}
        </p>
      ) : null}
      {store.statusError ? (
        <Notice variant="error">
          <strong>{t("connectors.statusError")}</strong>
          <span>{store.statusError.message}</span>
        </Notice>
      ) : null}

      <ul className="connectors-list">
        {PROVIDERS.map(({ id, label, hint }) => {
          const presence = store.presence(id);
          const isActive = store.active === id;
          const phase = isActive ? store.phase : "idle";
          const showYandexPanel =
            id !== "gsc" &&
            isActive &&
            (phase === "awaiting-code" ||
              phase === "finishing" ||
              (phase === "error" && store.authorizationUrl !== ""));
          const inputId = `${codeInputId}-${id}`;
          return (
            <li
              key={id}
              className="connectors-row"
              aria-labelledby={`connector-${id}`}
              aria-busy={store.busy && isActive ? true : undefined}
            >
              <div className="connectors-row-main">
                <div>
                  <h4 id={`connector-${id}`}>{t(label)}</h4>
                  <p className="muted small">{t(hint)}</p>
                </div>
                <div className="badge-row">
                  <Badge tone={presenceTone(presence)}>
                    {t(presenceLabel(presence))}
                  </Badge>
                  <Button
                    variant={presence === "connected" ? "secondary" : "primary"}
                    loading={phase === "starting"}
                    disabled={blocked || store.busy}
                    onClick={() => void store.connect(id, configPath)}
                  >
                    {t("connectors.connect")}
                  </Button>
                </div>
              </div>

              {id === "gsc" && isActive && phase === "starting" ? (
                <p className="muted small" role="status">
                  {t("connectors.browserHint")}
                </p>
              ) : null}

              {isActive && phase === "connected" ? (
                <p className="muted small" role="status">
                  {t("connectors.success")}
                </p>
              ) : null}

              {showYandexPanel ? (
                <div className="connectors-code">
                  <p className="muted small">{t("connectors.openHint")}</p>
                  <code className="callback connectors-url">
                    {store.authorizationUrl}
                  </code>
                  <div className="form-actions">
                    <Button
                      variant="secondary"
                      disabled={blocked || store.busy}
                      onClick={() => void store.openAuthorizationUrl()}
                    >
                      {t("connectors.openYandex")}
                    </Button>
                  </div>
                  {store.openError ? (
                    <InlineError>{store.openError.message}</InlineError>
                  ) : null}

                  <Field
                    id={inputId}
                    label={t("connectors.codeLabel")}
                    hint={
                      <>
                        {t("connectors.codeHint")}{" "}
                        <a
                          href={YANDEX_VERIFICATION_URL}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("connectors.verificationPage")}
                        </a>
                      </>
                    }
                  >
                    <Input
                      id={inputId}
                      value={store.code}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={blocked || phase === "finishing"}
                      onChange={(event) => store.setCode(event.target.value)}
                    />
                  </Field>
                  <div className="form-actions">
                    <Button
                      variant="primary"
                      loading={phase === "finishing"}
                      disabled={
                        blocked || store.busy || store.code.trim() === ""
                      }
                      onClick={() => void store.finish(configPath)}
                    >
                      {t("connectors.finish")}
                    </Button>
                  </div>
                </div>
              ) : null}

              {isActive && store.error ? <OAuthError error={store.error} /> : null}
            </li>
          );
        })}
      </ul>

      <Notice variant="info">
        <strong>{t("connectors.secretTitle")}</strong>
        <span>{t("connectors.secretHint")}</span>
        <code className="callback">
          lv24-seo auth set --provider gsc_oauth_secret --stdin
        </code>
        <code className="callback">
          lv24-seo auth set --provider yandex_oauth_secret --stdin
        </code>
      </Notice>

      <p className="muted small">
        {t("connectors.engineHint")}{" "}
        <a href={ENGINE_AUTH_DOCS_URL} target="_blank" rel="noreferrer">
          {t("connectors.docs")}
        </a>
      </p>
    </Card>
  );
});
