import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Notice } from "@/shared/ui/Notice";
import { BackupPanel } from "@/features/backup";
import { ConnectorsCard, ConnectorsStore } from "@/features/connectors";
import { IndexingPanel } from "@/features/indexing";
import { McpConfigPanel } from "@/features/mcp-config";
import { SchedulePanel } from "@/features/schedule";

/**
 * Local integrations: OAuth provider connectors, copy-ready MCP host snippets,
 * two-phase Bing indexing actions, a scheduler panel with a preview and an
 * explicitly confirmed host install, and a backup panel with create plus a
 * two-phase restore. Every write is confirmed first; the connectors only start
 * the engine's own OAuth flow and never receive a token.
 */
export const IntegrationsPage = observer(function IntegrationsPage() {
  const { t } = useI18n();
  const { engine } = useRootStore();
  const [connectors] = useState(() => new ConnectorsStore());
  const configPath = engine.status?.configPath ?? null;
  const blocked = engine.offline || engine.loading || !configPath;

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

      <ConnectorsCard
        store={connectors}
        configPath={configPath}
        blocked={blocked}
      />
      <McpConfigPanel />
      <IndexingPanel />
      <SchedulePanel />
      <BackupPanel />
    </section>
  );
});
