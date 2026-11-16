import type { LogDailyRow } from "@/entities/logs";
import { useI18n } from "@/shared/i18n";
import { formatNumber } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Table } from "@/shared/ui/Table";
import { BOT_KEYS, STATUS_KEYS } from "../model/labels";

function statusTone(
  status: LogDailyRow["status"],
): "success" | "info" | "warning" | "danger" | "neutral" {
  switch (status) {
    case "2xx":
      return "success";
    case "3xx":
      return "info";
    case "4xx":
      return "warning";
    case "5xx":
      return "danger";
    default:
      return "neutral";
  }
}

export function LogsTable({ rows }: { rows: readonly LogDailyRow[] }) {
  const { t, locale } = useI18n();
  return (
    <Table caption={t("logs.tableCaption")} className="logs-table">
      <colgroup>
        <col className="logs-col-date" />
        <col className="logs-col-bot" />
        <col className="logs-col-status" />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{t("logs.tableDate")}</th>
          <th scope="col">{t("logs.tableBot")}</th>
          <th scope="col">{t("logs.tableStatus")}</th>
          <th scope="col">{t("logs.tableHits")}</th>
          <th scope="col">{t("logs.tableBytes")}</th>
          <th scope="col">{t("logs.tableP95")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.date}|${row.bot}|${row.status}`}>
            <td>
              <code>{row.date}</code>
            </td>
            <td>{t(BOT_KEYS[row.bot])}</td>
            <td>
              <Badge tone={statusTone(row.status)}>
                {t(STATUS_KEYS[row.status])}
              </Badge>
            </td>
            <td>{formatNumber(row.hits, locale)}</td>
            <td>{formatNumber(row.bytes, locale)}</td>
            <td>{formatNumber(row.p95_ms, locale, 1)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
