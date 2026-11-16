import { describe, expect, it } from "vitest";
import {
  MCP_ARGS,
  MCP_CLIENTS,
  MCP_SERVER_NAME,
  SNIPPET_FORMATS,
  mcpClientConfigHint,
  mcpCommand,
  mcpCommandLine,
  mcpJsonSnippet,
  mcpSnippet,
  mcpTomlSnippet,
} from "../index";

const defaultCommand = mcpCommand(null);

describe("MCP snippet generation", () => {
  it("falls back to the CLI on PATH and prefers a bundled engine path", () => {
    expect(MCP_SERVER_NAME).toBe("lv24-seo");
    expect(MCP_ARGS).toEqual(["mcp", "serve"]);
    expect(mcpCommand("   ")).toEqual({
      command: "lv24-seo",
      args: ["mcp", "serve"],
    });
    expect(mcpCommand("C:\\Apps\\lv24-seo.exe")).toEqual({
      command: "C:\\Apps\\lv24-seo.exe",
      args: ["mcp", "serve"],
    });
  });

  it("renders Claude Desktop and Cursor with the mcpServers key", () => {
    for (const client of ["claude", "cursor"] as const) {
      expect(JSON.parse(mcpJsonSnippet(client, defaultCommand))).toEqual({
        mcpServers: {
          "lv24-seo": { command: "lv24-seo", args: ["mcp", "serve"] },
        },
      });
    }
  });

  it("renders OpenCode as a local command array", () => {
    expect(JSON.parse(mcpJsonSnippet("opencode", defaultCommand))).toEqual({
      mcp: {
        "lv24-seo": {
          type: "local",
          command: ["lv24-seo", "mcp", "serve"],
        },
      },
    });
  });

  it("renders VS Code as a stdio server", () => {
    expect(JSON.parse(mcpJsonSnippet("vscode", defaultCommand))).toEqual({
      servers: {
        "lv24-seo": {
          type: "stdio",
          command: "lv24-seo",
          args: ["mcp", "serve"],
        },
      },
    });
  });

  it("keeps a bundled engine path intact in the copy payload", () => {
    const command = mcpCommand("C:\\Program Files\\LV24\\engine.exe");
    const snippet = mcpJsonSnippet("claude", command);
    expect(snippet).toContain(
      '"command": "C:\\\\Program Files\\\\LV24\\\\engine.exe"',
    );
    expect(JSON.parse(snippet).mcpServers["lv24-seo"].command).toBe(
      "C:\\Program Files\\LV24\\engine.exe",
    );
    expect(mcpCommandLine(command)).toBe(
      '"C:\\Program Files\\LV24\\engine.exe" mcp serve',
    );
  });

  it("renders a TOML snippet for TOML hosts", () => {
    expect(mcpTomlSnippet(defaultCommand)).toBe(
      '[mcp_servers.lv24-seo]\ncommand = "lv24-seo"\nargs = ["mcp", "serve"]',
    );
  });

  it("switches format without changing the command", () => {
    expect(mcpSnippet("vscode", "toml", defaultCommand)).toBe(
      mcpTomlSnippet(defaultCommand),
    );
    expect(mcpSnippet("vscode", "json", defaultCommand)).toBe(
      mcpJsonSnippet("vscode", defaultCommand),
    );
  });

  it("never puts a credential in a snippet", () => {
    for (const client of MCP_CLIENTS) {
      for (const format of SNIPPET_FORMATS) {
        const snippet = mcpSnippet(client, format, defaultCommand).toLowerCase();
        expect(snippet, `${client} ${format}`).not.toContain("token");
        expect(snippet, `${client} ${format}`).not.toContain("secret");
        expect(snippet, `${client} ${format}`).not.toContain("password");
      }
    }
  });

  it("names one host config file per client", () => {
    const hints = MCP_CLIENTS.map((client) => mcpClientConfigHint(client));
    expect(hints.every((hint) => hint.trim() !== "")).toBe(true);
    expect(new Set(hints).size).toBe(MCP_CLIENTS.length);
  });
});
