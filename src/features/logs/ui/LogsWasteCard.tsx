import type { CrawlWaste } from "@/entities/logs";
import { useI18n } from "@/shared/i18n";
import { formatNumber, formatPercent } from "@/shared/lib/format";
import { Card } from "@/shared/ui/Card";
import { Table } from "@/shared/ui/Table";
import { BOT_KEYS } from "../model/labels";

/**
 * Wasted crawl volume from the engine. `share` is the engine's `waste_ratio`;
 * the raw hit/byte counts stay next to it so a percentage is never the only
 * evidence on screen.
 */
export function LogsWasteCard({ waste }: { waste: CrawlWaste }) {
  const { t, locale } = useI18n();
  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("logs.wasteTitle")}</h2>
          <p className="muted small">{t("logs.wasteHint")}</p>
        </div>
      </div>

      <div className="logs-facts">
        <div className="logs-fact">
          <span className="muted small">{t("logs.wasteHits")}</span>
          <strong>{formatNumber(waste.hits, locale)}</strong>
          <span className="muted small">
            {t("logs.wasteTotal", {
              hits: formatNumber(waste.total_hits, locale),
            })}
          </span>
        </div>
        <div className="logs-fact">
          <span className="muted small">{t("logs.wasteBytes")}</span>
          <strong>{formatNumber(waste.bytes, locale)}</strong>
        </div>
        <div className="logs-fact">
          <span className="muted small">{t("logs.wasteShare")}</span>
          <strong>{formatPercent(waste.share, locale, 1)}</strong>
        </div>
      </div>

      {waste.by_bot.length ? (
        <>
          <h3>{t("logs.wasteByBot")}</h3>
          <Table caption={t("logs.wasteByBot")} className="logs-waste-table">
            <thead>
              <tr>
                <th scope="col">{t("logs.tableBot")}</th>
                <th scope="col">{t("logs.tableHits")}</th>
                <th scope="col">{t("logs.tableBytes")}</th>
                <th scope="col">{t("logs.tableShare")}</th>
                <th scope="col">{t("logs.tableRequests")}</th>
              </tr>
            </thead>
            <tbody>
              {waste.by_bot.map((row) => (
                <tr key={row.bot}>
                  <td>{t(BOT_KEYS[row.bot])}</td>
                  <td>{formatNumber(row.hits, locale)}</td>
                  <td>{formatNumber(row.bytes, locale)}</td>
                  <td>{formatPercent(row.share, locale, 1)}</td>
                  <td>{formatNumber(row.total_hits, locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      ) : null}
    </Card>
  );
}
