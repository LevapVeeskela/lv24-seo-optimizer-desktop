import { describe, expect, it, vi } from "vitest";
import type { Envelope } from "@/shared/cli";
import type { InitProjectResult } from "@/entities/engine/api/onboarding";
import type { WorkspaceActivation } from "@/entities/workspace";
import {
  OnboardingStore,
  type OnboardingDeps,
} from "./OnboardingStore";

function initEnvelope(ok = true): Envelope<InitProjectResult> {
  if (!ok) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "bad property" },
      meta: {},
      warnings: [],
    };
  }
  return {
    ok: true,
    data: {
      config_path: "C:\\work\\alpha\\seo.toml",
      data_dir: "C:\\work\\alpha\\data",
      overwritten: false,
      project: { name: "example.com" },
    },
    meta: {},
    warnings: [],
  };
}

function makeDeps(overrides: Partial<OnboardingDeps> = {}) {
  const deps: OnboardingDeps = {
    pickDirectory: vi.fn(async () => "C:\\work\\alpha"),
    initProject: vi.fn(async () => initEnvelope()),
    activate: vi.fn(
      async (): Promise<WorkspaceActivation> => ({ ok: true, error: null }),
    ),
    pickConfig: vi.fn(async () => "C:\\work\\alpha\\seo.toml"),
    confirmWorkspaceChange: vi.fn(async () => true),
    ...overrides,
  };
  return deps;
}

function readyStore(deps = makeDeps()) {
  const store = new OnboardingStore(deps);
  store.setDirectory("C:\\work\\alpha");
  store.setSiteUrl("https://example.com");
  return { store, deps };
}

describe("OnboardingStore", () => {
  it("derives the exact config and data paths from the chosen folder", () => {
    const { store } = readyStore();
    expect(store.paths).toEqual({
      configPath: "C:\\work\\alpha\\seo.toml",
      dataDir: "C:\\work\\alpha\\data",
    });
  });

  it("blocks creation until the folder and a valid site URL are present", () => {
    const deps = makeDeps();
    const store = new OnboardingStore(deps);
    expect(store.canCreate).toBe(false);
    store.setDirectory("C:\\work\\alpha");
    expect(store.canCreate).toBe(false);
    store.setSiteUrl("example.com");
    expect(store.canCreate).toBe(false);
    store.setSiteUrl("https://example.com");
    expect(store.canCreate).toBe(true);
  });

  it("creates the project with the contract paths and activates it", async () => {
    const { store, deps } = readyStore();

    const created = await store.create();

    expect(created).toBe("C:\\work\\alpha\\seo.toml");
    expect(deps.initProject).toHaveBeenCalledWith({
      property: "https://example.com",
      configPath: "C:\\work\\alpha\\seo.toml",
      dataDir: "C:\\work\\alpha\\data",
    });
    expect(deps.activate).toHaveBeenCalledWith("C:\\work\\alpha\\seo.toml");
    expect(store.state).toBe("done");
    expect(store.result?.config_path).toBe("C:\\work\\alpha\\seo.toml");
  });

  it("does not create or switch when the discard prompt is cancelled", async () => {
    const deps = makeDeps({
      confirmWorkspaceChange: vi.fn(async () => false),
    });
    const { store } = readyStore(deps);

    expect(await store.create()).toBeNull();
    expect(deps.initProject).not.toHaveBeenCalled();
    expect(deps.activate).not.toHaveBeenCalled();
    expect(store.state).toBe("idle");

    expect(await store.chooseExistingConfig()).toBeNull();
    expect(deps.pickConfig).not.toHaveBeenCalled();
  });

  it("keeps the init error and does not activate a failed project", async () => {
    const deps = makeDeps({ initProject: vi.fn(async () => initEnvelope(false)) });
    const { store } = readyStore(deps);

    expect(await store.create()).toBeNull();
    expect(store.state).toBe("idle");
    expect(store.error?.code).toBe("INVALID_INPUT");
    expect(deps.activate).not.toHaveBeenCalled();
  });

  it("marks an existing seo.toml and can open it without init", async () => {
    const deps = makeDeps({
      initProject: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "CONFIG_INVALID",
          message: "C:\\work\\alpha\\seo.toml already exists",
          next_action: "pass --force to overwrite it",
        },
        meta: {},
        warnings: [],
      })),
    });
    const { store } = readyStore(deps);

    expect(await store.create()).toBeNull();
    expect(store.exists).toBe(true);
    expect(store.error?.code).toBe("ONBOARDING_CONFIG_EXISTS");

    expect(await store.useExisting()).toBe("C:\\work\\alpha\\seo.toml");
    expect(deps.initProject).toHaveBeenCalledTimes(1);
    expect(deps.activate).toHaveBeenCalledWith("C:\\work\\alpha\\seo.toml");
    expect(store.state).toBe("done");
  });

  it("reports activation failure after the project was created", async () => {
    const deps = makeDeps({
      activate: vi.fn(
        async (): Promise<WorkspaceActivation> => ({
          ok: false,
          error: {
            code: "PATH_NOT_APPROVED",
            message: "choose the config",
            retryable: false,
          },
        }),
      ),
    });
    const { store } = readyStore(deps);

    expect(await store.create()).toBeNull();
    expect(store.state).toBe("idle");
    expect(store.result?.config_path).toBe("C:\\work\\alpha\\seo.toml");
    expect(store.error?.code).toBe("PATH_NOT_APPROVED");
  });

  it("falls back to the native config picker when asked", async () => {
    const deps = makeDeps({ pickConfig: vi.fn(async () => "/srv/other/seo.toml") });
    const { store } = readyStore(deps);

    expect(await store.chooseExistingConfig()).toBe("/srv/other/seo.toml");
    expect(deps.activate).toHaveBeenCalledWith("/srv/other/seo.toml");
    expect(store.state).toBe("done");
  });

  it("keeps the current folder when the directory dialog is cancelled", async () => {
    const deps = makeDeps({ pickDirectory: vi.fn(async () => null) });
    const { store } = readyStore(deps);
    await store.chooseDirectory();
    expect(store.directory).toBe("C:\\work\\alpha");
    expect(store.choosing).toBe(false);
  });

  it("drops an in-flight creation after reset", async () => {
    let resolveInit!: (value: Envelope<InitProjectResult>) => void;
    const deps = makeDeps({
      initProject: vi.fn(
        () =>
          new Promise<Envelope<InitProjectResult>>((resolve) => {
            resolveInit = resolve;
          }),
      ),
    });
    const { store } = readyStore(deps);
    const pending = store.create();
    await vi.waitFor(() => expect(store.creating).toBe(true));

    store.reset();
    resolveInit(initEnvelope());

    expect(await pending).toBeNull();
    expect(store.state).toBe("idle");
    expect(store.error).toBeNull();
    expect(deps.activate).not.toHaveBeenCalled();
  });
});
