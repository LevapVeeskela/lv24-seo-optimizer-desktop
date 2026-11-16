import { useI18n } from "@/shared/i18n";
import { formatDateTime, formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Table } from "@/shared/ui/Table";
import { samePath } from "@/entities/workspace";
import type { PortfolioSite } from "../model/types";

export interface PortfolioTableViewProps {
  sites: readonly PortfolioSite[];
  activePath: string | null;
  busyPath: string | null;
  onOpen: (site: PortfolioSite) => void;
}

/**
 * One row per site. A per-site engine error is rendered in the row itself, so
 * a broken project is visible next to healthy ones instead of hiding the list
 * behind a single page-level error.
 */
export function PortfolioTable({
  sites,
  activePath,
  busyPath,
  onOpen,
}: PortfolioTableViewProps) {
  const { t, locale } = useI18n();
  return (
    <Table caption={t("portfolio.sitesTitle")} className="portfolio-table">
      <thead>
        <tr>
          <th scope="col">{t("portfolio.column.site")}</th>
          <th scope="col">{t("portfolio.column.lastActivity")}</th>
          <th scope="col">{t("portfolio.column.issues")}</th>
          <th scope="col">{t("portfolio.column.status")}</th>
          <th scope="col">{t("portfolio.column.action")}</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => {
          const active = samePath(site.configPath, activePath);
          const busy = samePath(site.configPath, busyPath);
          const total = site.issues.total;
          return (
            <tr key={site.configPath} aria-current={active ? "true" : undefined}>
              <td data-label={t("portfolio.column.site")}>
                <strong>{site.name}</strong>
                <div className="portfolio-site-meta">
                  {site.property ? (
                    <code>{site.property}</code>
                  ) : (
                    <span className="muted small">
                      {t("portfolio.noProperty")}
                    </span>
                  )}
                  <span className="muted small portfolio-path">
                    {site.configPath}
                  </span>
                </div>
              </td>
              <td data-label={t("portfolio.column.lastActivity")}>
                {site.lastActivity ? (
                  formatDateTime(site.lastActivity, locale)
                ) : (
                  <span className="muted small">{t("portfolio.noActivity")}</span>
                )}
              </td>
              <td data-label={t("portfolio.column.issues")}>
                {total === null ? (
                  <span className="muted small">
                    {t("portfolio.issuesUnknown")}
                  </span>
                ) : total === 0 ? (
                  <span className="muted small">{t("portfolio.noIssues")}</span>
                ) : (
                  <div className="portfolio-issues">
                    <strong>{formatNumber(total, locale)}</strong>
                    <div className="badge-row">
                      {site.issues.critical ? (
                        <Badge tone="danger">
                          {t("portfolio.issueCritical", {
                            count: site.issues.critical,
                          })}
                        </Badge>
                      ) : null}
                    </div>
                    {site.issues.all !== null &&
                    site.issues.all > total ? (
                      <span className="muted small">
                        {t("portfolio.issueAll", {
                          count: site.issues.all,
                        })}
                      </span>
                    ) : null}
                  </div>
                )}
              </td>
              <td data-label={t("portfolio.column.status")}>
                {site.error ? (
                  <div className="portfolio-site-error">
                    <Badge tone="danger">{t("portfolio.siteError")}</Badge>
                    <span className="muted small" title={site.error}>
                      {site.error}
                    </span>
                  </div>
                ) : active ? (
                  <Badge tone="success">{t("workspace.active")}</Badge>
                ) : (
                  <span className="muted small">{t("common.notAvailable")}</span>
                )}
              </td>
              <td data-label={t("portfolio.column.action")}>
                <Button
                  variant="secondary"
                  loading={busy}
                  disabled={busyPath !== null && !busy}
                  onClick={() => onOpen(site)}
                >
                  {busy ? t("workspace.activating") : t("portfolio.openWorkspace")}
                </Button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
