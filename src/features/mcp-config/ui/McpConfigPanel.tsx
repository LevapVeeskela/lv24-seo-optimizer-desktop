import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Card } from "@/shared/ui/Card";
import { Field } from "@/shared/ui/Field";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { CopyButton } from "@/entities/config";
import {
  MCP_CLIENTS,
  isMcpClient,
  isSnippetFormat,
  mcpClientConfigHint,
  mcpCommand,
  mcpCommandLine,
  mcpSnippet,
  type McpClient,
  type SnippetFormat,
} from "@/entities/integrations";

const CLIENT_LABEL_KEYS: Record<McpClient, MessageKey> = {
  claude: "integrations.mcp.client.claude",
  opencode: "integrations.mcp.client.opencode",
  vscode: "integrations.mcp.client.vscode",
  cursor: "integrations.mcp.client.cursor",
};

/**
 * Ready-to-copy MCP host snippets. Read-only: no host file is touched and no
 * provider token is part of the payload.
 */
export const McpConfigPanel = observer(function McpConfigPanel() {
  const { t } = useI18n();
  const { engine } = useRootStore();
  const [client, setClient] = useState<McpClient>("claude");
  const [format, setFormat] = useState<SnippetFormat>("json");

  const enginePath = engine.status?.engine?.path ?? null;
  const command = mcpCommand(enginePath);
  const snippet = mcpSnippet(client, format, command);
  const clientLabel = t(CLIENT_LABEL_KEYS[client]);

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("integrations.mcp.title")}</h2>
          <p className="muted small">{t("integrations.mcp.subtitle")}</p>
        </div>
        <Badge tone="info">{t("integrations.readOnlyBadge")}</Badge>
      </div>

      <div className="badge-row">
        <Badge tone={enginePath ? "success" : "neutral"}>
          {enginePath
            ? t("integrations.mcp.bundled")
            : t("integrations.mcp.pathCommand")}
        </Badge>
        <code>{mcpCommandLine(command)}</code>
      </div>

      <div className="form-grid">
        <Field
          id="mcp-client"
          label={t("integrations.mcp.client")}
          hint={t("integrations.mcp.hostFile", {
            path: mcpClientConfigHint(client),
          })}
        >
          <Select
            id="mcp-client"
            value={client}
            onChange={(event) => {
              if (isMcpClient(event.target.value)) {
                setClient(event.target.value);
              }
            }}
          >
            {MCP_CLIENTS.map((id) => (
              <option key={id} value={id}>
                {t(CLIENT_LABEL_KEYS[id])}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          id="mcp-format"
          label={t("integrations.mcp.format")}
          hint={t("integrations.mcp.formatHint")}
        >
          <Select
            id="mcp-format"
            value={format}
            onChange={(event) => {
              if (isSnippetFormat(event.target.value)) {
                setFormat(event.target.value);
              }
            }}
          >
            <option value="json">{t("integrations.mcp.formatJson")}</option>
            <option value="toml">{t("integrations.mcp.formatToml")}</option>
          </Select>
        </Field>
      </div>

      {format === "toml" ? (
        <p className="muted small">{t("integrations.mcp.tomlHint")}</p>
      ) : null}

      <div className="form-actions">
        <CopyButton
          value={snippet}
          label={t("common.copy")}
          copiedLabel={t("common.copied")}
        />
      </div>

      <pre
        className="log-output"
        aria-label={t("integrations.mcp.snippetLabel", { client: clientLabel })}
        tabIndex={0}
      >
        {snippet}
      </pre>

      <p className="muted small">{t("integrations.mcp.noSecrets")}</p>

      {engine.offline ? (
        <Notice variant="info">
          <span>{t("integrations.mcp.offlineHint")}</span>
        </Notice>
      ) : null}
    </Card>
  );
});
