import { describe, expect, it, vi } from "vitest";
import type { PortfolioSite } from "../model/types";
import { openPortfolioSite, type WorkspaceActivator } from "./openWorkspace";

function site(configPath: string, error: string | null = null): PortfolioSite {
  return {
    configPath,
    name: "shop",
    property: null,
    lastActivity: null,
    issues: { total: null, critical: null, all: null },
    error,
  };
}

describe("openPortfolioSite", () => {
  it("opens the site through the workspace store", async () => {
    const activate = vi.fn(async () => ({ ok: true, error: null }));
    const workspace: WorkspaceActivator = { activate };

    const result = await openPortfolioSite(workspace, site("/srv/shop/seo.toml"));

    expect(activate).toHaveBeenCalledWith("/srv/shop/seo.toml");
    expect(result).toEqual({ ok: true, configPath: "/srv/shop/seo.toml" });
  });

  it("passes the workspace error through unchanged", async () => {
    const error = {
      code: "PATH_NOT_APPROVED",
      message: "The path is outside the approved roots.",
      retryable: false,
    };
    const workspace: WorkspaceActivator = {
      activate: async () => ({ ok: false, error }),
    };

    const result = await openPortfolioSite(workspace, site("/srv/shop/seo.toml"));

    expect(result).toEqual({ ok: false, error });
  });

  it("does not call the shell for a row without a config path", async () => {
    const activate = vi.fn(async () => ({ ok: true, error: null }));
    const workspace: WorkspaceActivator = { activate };

    const result = await openPortfolioSite(workspace, site("  "));

    expect(activate).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PORTFOLIO_CONFIG_MISSING");
    }
  });

  it("still attempts a row whose per-site scan reported an error", async () => {
    const activate = vi.fn(async () => ({ ok: true, error: null }));
    const workspace: WorkspaceActivator = { activate };

    const result = await openPortfolioSite(
      workspace,
      site("/srv/shop/seo.toml", "stale snapshot"),
    );

    expect(activate).toHaveBeenCalledWith("/srv/shop/seo.toml");
    expect(result.ok).toBe(true);
  });
});
