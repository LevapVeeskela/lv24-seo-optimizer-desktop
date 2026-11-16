import { describe, expect, it, vi } from "vitest";
import { WorkspaceStore, type WorkspaceDeps } from "./WorkspaceStore";
import {
  MAX_RECENT_WORKSPACES,
  RECENT_WORKSPACES_KEY,
  type StorageLike,
} from "./types";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(RECENT_WORKSPACES_KEY, initial);
  }
  const storage: StorageLike & { values: Map<string, string> } = {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
  return storage;
}

function makeDeps(overrides: Partial<WorkspaceDeps> = {}) {
  let active: string | null = null;
  const deps: WorkspaceDeps = {
    setConfigPath: vi.fn(async (path: string) => {
      active = path;
    }),
    reloadShell: vi.fn(async () => undefined),
    activePath: () => active,
    refreshStats: vi.fn(async () => undefined),
    configMissing: () => false,
    ...overrides,
  };
  return { deps, setActive: (path: string | null) => (active = path) };
}

describe("WorkspaceStore", () => {
  it("restores a persisted list and drops corrupted entries", () => {
    const storage = memoryStorage(
      JSON.stringify([
        { path: "C:\\work\\alpha\\seo.toml", label: "alpha", site: "https://alpha.test" },
        { path: "C:\\work\\alpha\\seo.toml", label: "duplicate" },
        { path: "  " },
        { label: "no path" },
        "not an entry",
      ]),
    );
    const { deps } = makeDeps();
    const store = new WorkspaceStore(deps, storage);

    expect(store.recents).toHaveLength(1);
    expect(store.recents[0]).toMatchObject({
      path: "C:\\work\\alpha\\seo.toml",
      label: "alpha",
      site: "https://alpha.test",
    });
  });

  it("ignores invalid JSON instead of breaking the header", () => {
    const { deps } = makeDeps();
    const store = new WorkspaceStore(deps, memoryStorage("{oops"));
    expect(store.recents).toEqual([]);
  });

  it("keeps the newest entry first, deduplicates and caps the list", () => {
    const storage = memoryStorage();
    const { deps } = makeDeps();
    const store = new WorkspaceStore(deps, storage);

    for (let index = 0; index < MAX_RECENT_WORKSPACES + 3; index += 1) {
      store.remember({ path: `C:\\work\\site-${index}\\seo.toml` });
    }
    expect(store.recents).toHaveLength(MAX_RECENT_WORKSPACES);
    expect(store.recents[0].path).toBe(
      `C:\\work\\site-${MAX_RECENT_WORKSPACES + 2}\\seo.toml`,
    );

    store.remember({
      path: "c:/WORK/site-10/seo.toml",
      label: "Renamed",
      site: "https://renamed.test",
    });
    expect(store.recents).toHaveLength(MAX_RECENT_WORKSPACES);
    expect(store.recents[0]).toMatchObject({
      label: "Renamed",
      site: "https://renamed.test",
    });
    expect(
      store.recents.filter((entry) =>
        entry.path.toLowerCase().includes("site-10"),
      ),
    ).toHaveLength(1);
  });

  it("persists every change and clears the stored list on demand", () => {
    const storage = memoryStorage();
    const { deps } = makeDeps();
    const store = new WorkspaceStore(deps, storage);

    store.remember({ path: "/srv/alpha/seo.toml" });
    expect(JSON.parse(storage.values.get(RECENT_WORKSPACES_KEY) ?? "[]")).toHaveLength(1);

    store.clear();
    expect(store.recents).toEqual([]);
    expect(JSON.parse(storage.values.get(RECENT_WORKSPACES_KEY) ?? "null")).toEqual([]);
  });

  it("activates through settings, reloads the shell and refreshes stats", async () => {
    const { deps } = makeDeps();
    const store = new WorkspaceStore(deps, memoryStorage());

    const result = await store.activate("C:\\work\\alpha\\seo.toml");

    expect(result.ok).toBe(true);
    expect(deps.setConfigPath).toHaveBeenCalledWith("C:\\work\\alpha\\seo.toml");
    expect(deps.reloadShell).toHaveBeenCalledTimes(1);
    expect(deps.refreshStats).toHaveBeenCalledTimes(1);
    expect(store.recents[0].path).toBe("C:\\work\\alpha\\seo.toml");
  });

  it("does not touch settings when the requested workspace is already active", async () => {
    const { deps, setActive } = makeDeps();
    setActive("/srv/alpha/seo.toml");
    const store = new WorkspaceStore(deps, memoryStorage());

    const result = await store.activate("/srv/alpha/seo.toml");

    expect(result.ok).toBe(true);
    expect(deps.setConfigPath).not.toHaveBeenCalled();
    expect(deps.refreshStats).not.toHaveBeenCalled();
  });

  it("fails honestly when the shell reports another config path", async () => {
    const { deps, setActive } = makeDeps({
      setConfigPath: vi.fn(async () => undefined),
    });
    setActive("C:\\work\\other\\seo.toml");
    const store = new WorkspaceStore(deps, memoryStorage());

    const result = await store.activate("C:\\work\\alpha\\seo.toml");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("WORKSPACE_NOT_ACTIVATED");
    expect(store.recents).toEqual([]);
    expect(deps.refreshStats).not.toHaveBeenCalled();
  });

  it("keeps a typed shell error and never claims success", async () => {
    const { deps } = makeDeps({
      setConfigPath: vi.fn(async () => {
        throw { code: "PATH_NOT_APPROVED", message: "choose the config" };
      }),
    });
    const store = new WorkspaceStore(deps, memoryStorage());

    const result = await store.activate("/srv/alpha/seo.toml");

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("PATH_NOT_APPROVED");
    expect(store.activatingPath).toBeNull();
  });

  it("skips stats when the activated config file is missing", async () => {
    const { deps } = makeDeps({ configMissing: () => true });
    const store = new WorkspaceStore(deps, memoryStorage());

    expect((await store.activate("/srv/alpha/seo.toml")).ok).toBe(true);
    expect(deps.refreshStats).not.toHaveBeenCalled();
  });
});
