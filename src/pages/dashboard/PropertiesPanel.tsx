import { useEffect } from "react";
import { observer } from "mobx-react-lite";
import { Link } from "react-router-dom";
import { useRootStore } from "@/app/providers/StoreProvider";
import { ROUTES } from "@/app/routes";
import {
  providerLabelKey,
  type PropertyRow,
  type PropertyTokenState,
} from "@/entities/workspace";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { appErrorText } from "@/shared/lib/errors";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { EmptyState } from "@/shared/ui/EmptyState";
import { Loading } from "@/shared/ui/Loading";
import { Notice } from "@/shared/ui/Notice";
import { Table } from "@/shared/ui/Table";

const TOKEN_KEYS: Record<PropertyTokenState, MessageKey> = {
  present: "secrets.present",
  missing: "secrets.missing",
  not_required: "dashboard.propertiesTokenNotRequired",
  unknown: "secrets.unknown",
};

function tokenTone(token: PropertyTokenState) {
  if (token === "present" || token === "not_required") {
    return "success" as const;
  }
  if (token === "missing") {
    return "warning" as const;
  }
  return "neutral" as const;
}

/**
 * `lv24-seo properties` is the engine's own view of the workspace: which
 * providers are configured, their target and whether a token is present.
 * The panel never guesses a token state from the config file.
 */
export const PropertiesPanel = observer(function PropertiesPanel() {
  const { t } = useI18n();
  const { engine, properties } = useRootStore();
  const configPath = engine.status?.configPath ?? null;

  useEffect(() => {
    if (configPath) {
      void properties.load(configPath);
    }
  }, [configPath, properties]);

  const project = properties.project;
  const configured = properties.configuredRows;
  const unconfigured = properties.rows.length - configured.length;

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("dashboard.properties")}</h2>
          <p className="muted small">{t("dashboard.propertiesHint")}</p>
        </div>
        <Button
          variant="secondary"
          loading={properties.loading}
          disabled={!configPath}
          onClick={() => void properties.refresh()}
        >
          {properties.loading ? t("actions.refreshing") : t("common.refresh")}
        </Button>
      </div>

      {!configPath ? (
        <EmptyState
          title={t("dashboard.noConfigTitle")}
          hint={t("dashboard.noConfigHint")}
          action={
            <Link className="btn btn-primary" to={ROUTES.onboarding}>
              {t("dashboard.createProject")}
            </Link>
          }
        />
      ) : properties.error ? (
        <Notice
          variant="error"
          action={
            <Button
              variant="secondary"
              onClick={() => void properties.refresh()}
            >
              {t("common.retry")}
            </Button>
          }
        >
          <strong>{t("dashboard.propertiesError")}</strong>
          <span>{appErrorText(properties.error)}</span>
        </Notice>
      ) : properties.loading && !properties.hasData ? (
        <Loading label={t("common.loading")} />
      ) : properties.hasData && configured.length === 0 ? (
        <EmptyState
          title={t("dashboard.propertiesEmptyTitle")}
          hint={t("dashboard.propertiesEmptyHint")}
          action={
            <Link className="btn btn-secondary" to={ROUTES.settings}>
              {t("dashboard.propertiesOpenSettings")}
            </Link>
          }
        />
      ) : properties.hasData ? (
        <>
          {project && (project.name || project.baseUrl) ? (
            <dl className="onboarding-summary">
              {project.name ? (
                <>
                  <dt>{t("dashboard.propertiesProject")}</dt>
                  <dd>{project.name}</dd>
                </>
              ) : null}
              {project.baseUrl ? (
                <>
                  <dt>{t("dashboard.propertiesBaseUrl")}</dt>
                  <dd><code>{project.baseUrl}</code></dd>
                </>
              ) : null}
              {project.defaultProperty ? (
                <>
                  <dt>{t("dashboard.propertiesDefaultProperty")}</dt>
                  <dd><code>{project.defaultProperty}</code></dd>
                </>
              ) : null}
            </dl>
          ) : null}

          <Table caption={t("dashboard.properties")}>
            <thead>
              <tr>
                <th scope="col">{t("dashboard.propertiesProvider")}</th>
                <th scope="col">{t("dashboard.propertiesTarget")}</th>
                <th scope="col">{t("dashboard.propertiesToken")}</th>
                <th scope="col">{t("dashboard.propertiesReady")}</th>
              </tr>
            </thead>
            <tbody>
              {configured.map((row: PropertyRow) => {
                const labelKey = providerLabelKey(row.provider);
                return (
                  <tr key={row.provider}>
                    <td>{labelKey ? t(labelKey) : row.provider}</td>
                    <td>{row.target ?? t("common.none")}</td>
                    <td>
                      <Badge tone={tokenTone(row.token)}>
                        {t(TOKEN_KEYS[row.token])}
                      </Badge>
                    </td>
                    <td>
                      <Badge tone={row.ready ? "success" : "neutral"}>
                        {row.ready ? t("service.ready") : t("service.notReady")}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>

          {unconfigured > 0 ? (
            <p className="muted small">
              {t("dashboard.propertiesNotConfiguredCount", { count: unconfigured })}{" "}
              <Link to={ROUTES.settings}>
                {t("dashboard.propertiesOpenSettings")}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </Card>
  );
});
