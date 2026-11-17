import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import {
  BingPanel,
  CwvPanel,
  GooglePanel,
  MetrikaPanel,
  YandexPanel,
} from "@/features/diagnostics";
import "@/features/diagnostics/ui/diagnostics.css";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Notice } from "@/shared/ui/Notice";
import { Tabs } from "@/shared/ui/Tabs";

/**
 * Read-only platform diagnostics: GSC, Yandex Webmaster, Bing, Metrika and
 * Core Web Vitals. Every tab maps to allow-listed engine reads; nothing on
 * this page writes provider or local state.
 */
export function DiagnosticsPage() {
  const { t } = useI18n();
  const { engine } = useRootStore();
  const configPath = engine.status?.configPath ?? null;

  return (
    <div className="page">
      <Card>
        <div className="card-header">
          <div>
            <h2>{t("diagnostics.title")}</h2>
            <p className="muted small">{t("diagnostics.subtitle")}</p>
          </div>
          <Badge tone="neutral">{t("diagnostics.readOnly")}</Badge>
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
            <strong>{t("diagnostics.offlineTitle")}</strong>
            <span>{t("diagnostics.offlineHint")}</span>
          </Notice>
        ) : null}

        {!configPath && !engine.loading && !engine.offline ? (
          <Notice
            variant="info"
            action={
              <Link className="btn btn-secondary" to="/settings">
                {t("diagnostics.openSettings")}
              </Link>
            }
          >
            <strong>{t("diagnostics.noWorkspaceTitle")}</strong>
            <span>{t("diagnostics.noWorkspaceHint")}</span>
          </Notice>
        ) : null}

        <p className="muted small">{t("diagnostics.readOnlyHint")}</p>

        <Tabs
          label={t("diagnostics.tabsLabel")}
          items={[
            {
              id: "google",
              label: t("diagnostics.tab.google"),
              content: <GooglePanel />,
            },
            {
              id: "yandex",
              label: t("diagnostics.tab.yandex"),
              content: <YandexPanel />,
            },
            {
              id: "bing",
              label: t("diagnostics.tab.bing"),
              content: <BingPanel />,
            },
            {
              id: "metrika",
              label: t("diagnostics.tab.metrika"),
              content: <MetrikaPanel />,
            },
            {
              id: "cwv",
              label: t("diagnostics.tab.cwv"),
              content: <CwvPanel />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
