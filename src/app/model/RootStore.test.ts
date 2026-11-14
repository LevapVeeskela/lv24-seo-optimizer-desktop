import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@/shared/cli", () => ({ shellStatus: vi.fn(), cliRun: vi.fn() }));

import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { isObservableProp } from "mobx";
import { cliRun, shellStatus } from "@/shared/cli";
import { ConfigStore } from "@/entities/config";
import { UpdateStore } from "@/entities/update";
import { RootStore } from "./RootStore";

const engine = { found: true, version: "0.5.0", compatible: true };

const roots: RootStore[] = [];

function makeRoot(): RootStore {
  const root = new RootStore();
  roots.push(root);
  return root;
}

describe("RootStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getVersion).mockResolvedValue("0.1.0");
    vi.mocked(check).mockResolvedValue(null);
    vi.mocked(cliRun).mockResolvedValue({
      ok: true,
      data: {},
      meta: {},
      warnings: [],
    });
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      root.dispose();
    }
  });

  it("owns one shared ConfigStore for Settings and Config", () => {
    const root = makeRoot();
    expect(root.config).toBeInstanceOf(ConfigStore);
    expect(root.config).toBe(root.config);
    // Stores are wired once and never deep-observed by the root store.
    expect(isObservableProp(root, "config")).toBe(false);
  });

  it("owns one UpdateStore outside deep observation", () => {
    const root = makeRoot();
    expect(root.update).toBeInstanceOf(UpdateStore);
    expect(isObservableProp(root, "update")).toBe(false);
  });

  it("runs one silent update check after bootstrap without blocking", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: null,
    });

    const root = makeRoot();
    await root.bootstrap();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));

    expect(root.update.currentVersion).toBe("0.1.0");
    expect(root.update.state).toBe("idle");

    await root.bootstrap();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("disables the updater for a portable sibling-engine build", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine: { ...engine, source: "sibling" },
      bundleKind: "nsis",
      configPath: null,
    });

    const root = makeRoot();
    await root.bootstrap();

    expect(root.update.isPortable).toBe(true);
    expect(root.update.canAutoUpdate).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("treats a flat bundled portable ZIP as portable", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine: { ...engine, source: "bundled-flat" },
      bundleKind: "nsis",
      configPath: null,
    });

    const root = makeRoot();
    await root.bootstrap();

    expect(root.update.isPortable).toBe(true);
    expect(root.update.canAutoUpdate).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("disables in-app updates for a deb bundle", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "deb",
      configPath: null,
    });

    const root = makeRoot();
    await root.bootstrap();

    expect(root.update.canAutoUpdate).toBe(false);
    expect(check).not.toHaveBeenCalled();
  });

  it("does not refresh stats without a selected workspace", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: null,
    });

    const root = makeRoot();
    await root.bootstrap();

    expect(cliRun).not.toHaveBeenCalled();
  });

  it("refreshes stats when a workspace is selected", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: "C:\\work\\seo.toml",
    });

    const root = makeRoot();
    await root.bootstrap();

    expect(cliRun).toHaveBeenCalledWith("stats");
  });

  it("clears stats, reports and the report HTML path on a workspace switch", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: "C:\\work\\alpha\\seo.toml",
    });
    const root = makeRoot();
    await root.bootstrap();

    expect(root.stats.hasData).toBe(true);
    root.reports.report = { headline: "alpha" };
    root.reports.meta = {
      artifacts: { html: "C:\\work\\alpha\\data\\report.html" },
    };
    expect(root.reports.hasReport).toBe(true);

    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: "C:\\work\\beta\\seo.toml",
    });
    await root.engine.load();

    expect(root.stats.hasData).toBe(false);
    expect(root.stats.state).toBe("idle");
    expect(root.stats.lastUpdated).toBeNull();
    expect(root.reports.hasReport).toBe(false);
    expect(root.reports.meta).toEqual({});
    expect(root.reports.state).toBe("idle");
  });

  it("keeps workspace data when the shell reports the same config path", async () => {
    vi.mocked(shellStatus).mockResolvedValue({
      engine,
      bundleKind: "nsis",
      configPath: "C:\\work\\alpha\\seo.toml",
    });
    const root = makeRoot();
    await root.bootstrap();
    root.reports.report = { headline: "alpha" };

    await root.engine.load();

    expect(root.stats.hasData).toBe(true);
    expect(root.reports.hasReport).toBe(true);
  });
});
