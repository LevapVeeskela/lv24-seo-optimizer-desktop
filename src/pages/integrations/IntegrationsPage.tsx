import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Notice } from "@/shared/ui/Notice";
import { BackupPanel } from "@/features/backup";
import { McpConfigPanel } from "@/features/mcp-config";
import { SchedulePanel } from "@/features/schedule";

/**
 * Local integrations: copy-ready MCP host snippets, a print-only scheduler
 * artifact and a backup creator. Only the backup panel writes, and only one
 * archive into the folder the user picks.
 */
export const IntegrationsPage = function IntegrationsPage() {
  const { t } = useI18n();
  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{t("integrations.title")}</h1>
          <p className="muted">{t("integrations.subtitle")}</p>
        </div>
        <div className="page-actions">
          <Badge tone="info">{t("integrations.readOnlyBadge")}</Badge>
        </div>
      </header>

      <Notice variant="info">
        <span>{t("integrations.readOnlyHint")}</span>
      </Notice>

      <McpConfigPanel />
      <SchedulePanel />
      <BackupPanel />
    </section>
  );
};
