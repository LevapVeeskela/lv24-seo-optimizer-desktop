import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Notice } from "@/shared/ui/Notice";
import { BackupPanel } from "@/features/backup";
import { McpConfigPanel } from "@/features/mcp-config";
import { SchedulePanel } from "@/features/schedule";

/**
 * Local integrations: copy-ready MCP host snippets, a scheduler panel with a
 * preview and an explicitly confirmed host install, and a backup panel with
 * create plus a two-phase restore. Every write is local and confirmed first.
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
