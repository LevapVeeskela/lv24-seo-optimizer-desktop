import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Notice } from "@/shared/ui/Notice";
import { McpConfigPanel } from "@/features/mcp-config";
import { SchedulePanel } from "@/features/schedule";

/**
 * Read-only integrations: copy-ready MCP host snippets and a print-only
 * scheduler artifact. The page writes nothing and installs nothing.
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
    </section>
  );
};
