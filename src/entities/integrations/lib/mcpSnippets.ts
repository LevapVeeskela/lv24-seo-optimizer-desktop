import type { McpClient, SnippetFormat } from "../model/types";

/**
 * Snippets are plain text for the clipboard: the desktop never edits a host
 * client config. They contain no tokens; the MCP server reads provider
 * credentials from the OS keychain or LV24_SEO_* variables.
 */
export interface McpCommand {
  command: string;
  args: string[];
}

export const MCP_SERVER_NAME = "lv24-seo";
export const MCP_ARGS: readonly string[] = ["mcp", "serve"];

/** Prefer the bundled engine binary; fall back to the CLI on PATH. */
export function mcpCommand(enginePath: string | null | undefined): McpCommand {
  const path = enginePath?.trim();
  return { command: path || MCP_SERVER_NAME, args: [...MCP_ARGS] };
}

function shellToken(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** One-line command for display only; host configs take command + args. */
export function mcpCommandLine(command: McpCommand): string {
  return [command.command, ...command.args].map(shellToken).join(" ");
}

function serverEntry(client: McpClient, command: McpCommand): unknown {
  if (client === "opencode") {
    return {
      type: "local",
      command: [command.command, ...command.args],
    };
  }
  if (client === "vscode") {
    return {
      type: "stdio",
      command: command.command,
      args: [...command.args],
    };
  }
  // Claude Desktop and Cursor share the mcpServers shape.
  return {
    command: command.command,
    args: [...command.args],
  };
}

function rootKey(client: McpClient): string {
  if (client === "opencode") {
    return "mcp";
  }
  if (client === "vscode") {
    return "servers";
  }
  return "mcpServers";
}

export function mcpJsonSnippet(client: McpClient, command: McpCommand): string {
  return JSON.stringify(
    { [rootKey(client)]: { [MCP_SERVER_NAME]: serverEntry(client, command) } },
    null,
    2,
  );
}

/** TOML variant for hosts that read TOML (for example Codex CLI). */
export function mcpTomlSnippet(command: McpCommand): string {
  const args = command.args.map((arg) => JSON.stringify(arg)).join(", ");
  return [
    `[mcp_servers.${MCP_SERVER_NAME}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = [${args}]`,
  ].join("\n");
}

export function mcpSnippet(
  client: McpClient,
  format: SnippetFormat,
  command: McpCommand,
): string {
  return format === "toml"
    ? mcpTomlSnippet(command)
    : mcpJsonSnippet(client, command);
}

/** Where the host keeps its MCP config; technical paths stay untranslated. */
export function mcpClientConfigHint(client: McpClient): string {
  const hints: Record<McpClient, string> = {
    claude: "claude_desktop_config.json",
    opencode: "opencode.json",
    vscode: ".vscode/mcp.json",
    cursor: "~/.cursor/mcp.json",
  };
  return hints[client];
}
