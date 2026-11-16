import { describe, expect, it } from "vitest";
import {
  DEFAULT_WINDOW,
  WINDOW_SETTINGS_KEY,
  WindowStore,
  parseWindowSettingsMap,
  sameWindowParams,
  type StorageLike,
} from "../index";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
    } satisfies StorageLike,
    read: (key: string) => map.get(key) ?? null,
  };
}

describe("WindowStore", () => {
  it("starts from the audited default when nothing is stored", () => {
    const store = new WindowStore(null);
    expect(store.params).toEqual(DEFAULT_WINDOW);
    expect(store.isDefault).toBe(true);
    expect(store.workspacePath).toBeNull();
  });

  it("persists days and lag per workspace and restores them on return", () => {
    const memory = memoryStorage();
    const store = new WindowStore(memory.storage);

    store.useWorkspace("C:\\projects\\a\\seo.toml");
    store.setDays(28);
    store.setLagDays(3);
    expect(store.params).toEqual({ days: 28, lagDays: 3 });

    // A different workspace never inherits the previous choice.
    store.useWorkspace("C:\\projects\\b\\seo.toml");
    expect(store.params).toEqual(DEFAULT_WINDOW);

    store.setDays(90);
    store.useWorkspace("C:\\projects\\a\\seo.toml");
    expect(store.params).toEqual({ days: 28, lagDays: 3 });

    // A fresh store reads the same per-workspace map.
    const reloaded = new WindowStore(memory.storage);
    reloaded.useWorkspace("C:\\projects\\a\\seo.toml");
    expect(reloaded.params).toEqual({ days: 28, lagDays: 3 });
    expect(memory.read(WINDOW_SETTINGS_KEY)).toContain("C:\\\\projects\\\\a");
  });

  it("resets to the default and forgets the saved entry for the workspace", () => {
    const memory = memoryStorage();
    const store = new WindowStore(memory.storage);
    store.useWorkspace("/projects/a/seo.toml");
    store.setDays(90);
    store.setLagDays(3);

    store.reset();
    expect(store.params).toEqual(DEFAULT_WINDOW);
    expect(store.isDefault).toBe(true);

    const reloaded = new WindowStore(memory.storage);
    reloaded.useWorkspace("/projects/a/seo.toml");
    expect(reloaded.params).toEqual(DEFAULT_WINDOW);
  });

  it("ignores values outside the offered presets", () => {
    const memory = memoryStorage();
    const store = new WindowStore(memory.storage);
    store.useWorkspace("/projects/a/seo.toml");

    store.setDays(14);
    store.setLagDays(0);
    expect(store.params).toEqual(DEFAULT_WINDOW);
    expect(memory.read(WINDOW_SETTINGS_KEY)).toBeNull();
  });

  it("survives corrupted storage and invalid entries", () => {
    expect(parseWindowSettingsMap("{not json")).toEqual({});
    expect(
      parseWindowSettingsMap(
        JSON.stringify({
          version: 1,
          workspaces: {
            "/a": { days: 28, lagDays: 3 },
            "/b": { days: 14, lagDays: 2 },
            "/c": "nope",
          },
        }),
      ),
    ).toEqual({ "/a": { days: 28, lagDays: 3 } });

    const store = new WindowStore({
      getItem: () => {
        throw new Error("storage locked");
      },
      setItem: () => {
        throw new Error("storage locked");
      },
    });
    store.useWorkspace("/projects/a/seo.toml");
    expect(() => store.setDays(28)).not.toThrow();
    expect(store.days).toBe(28);
  });

  it("compares the requested window with the window a run used", () => {
    expect(sameWindowParams({ days: 7, lagDays: 2 }, DEFAULT_WINDOW)).toBe(true);
    expect(sameWindowParams({ days: 28, lagDays: 2 }, DEFAULT_WINDOW)).toBe(
      false,
    );
    expect(sameWindowParams(null, DEFAULT_WINDOW)).toBe(false);
  });
});
