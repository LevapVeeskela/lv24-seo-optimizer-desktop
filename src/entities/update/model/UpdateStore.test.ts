import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { UPDATE_PROGRESS_EVENT } from "../lib/shell";
import { UpdateStore } from "./UpdateStore";

const getVersionMock = vi.mocked(getVersion);
const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

type ProgressHandler = (event: {
  payload: { downloaded: number; total: number | null };
}) => void;

let progressHandler: ProgressHandler | null = null;
let unlistenMock: ReturnType<typeof vi.fn>;

function fakeUpdate(version = "0.2.0") {
  return {
    version,
    date: "2026-11-14T10:00:00Z",
    body: "Fixes\nFaster",
    close: vi.fn(async () => {}),
  };
}

function asUpdate(update: ReturnType<typeof fakeUpdate>): Update {
  return update as unknown as Update;
}

function emitProgress(downloaded: number, total: number | null): void {
  progressHandler?.({ payload: { downloaded, total } });
}

function commands(): string[] {
  return invokeMock.mock.calls.map(([command]) => String(command));
}

describe("UpdateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    progressHandler = null;
    unlistenMock = vi.fn();
    getVersionMock.mockResolvedValue("0.1.0");
    relaunchMock.mockResolvedValue(undefined);
    listenMock.mockImplementation((async (
      _event: string,
      handler: ProgressHandler,
    ) => {
      progressHandler = handler;
      return unlistenMock;
    }) as never);
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      if (command === "update_install") {
        return { version: "0.2.0", installed: true };
      }
      if (command === "update_cancel") {
        return true;
      }
      return 0;
    }) as never);
  });

  it("announces a newer release and reuses the current version", async () => {
    const first = fakeUpdate();
    const second = fakeUpdate();
    checkMock
      .mockResolvedValueOnce(asUpdate(first))
      .mockResolvedValueOnce(asUpdate(second));
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(true);

    expect(checkMock).toHaveBeenCalledWith({ timeout: 30_000 });
    expect(store.state).toBe("available");
    expect(store.currentVersion).toBe("0.1.0");
    expect(store.available).toEqual({
      version: "0.2.0",
      date: "2026-11-14T10:00:00Z",
      notes: "Fixes\nFaster",
    });
    expect(store.lastChecked).not.toBeNull();
    expect(store.lastCheckFailed).toBe(false);

    await store.check();
    expect(getVersionMock).toHaveBeenCalledTimes(1);
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();
  });

  it("returns to idle when the endpoint reports no update", async () => {
    checkMock.mockResolvedValue(null);
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(false);

    expect(store.state).toBe("idle");
    expect(store.available).toBeNull();
    expect(store.lastChecked).not.toBeNull();
    expect(store.error).toBeNull();
  });

  it("survives an unreadable current version", async () => {
    getVersionMock.mockRejectedValue(new Error("no ipc"));
    checkMock.mockResolvedValue(null);
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(false);

    expect(store.currentVersion).toBeNull();
    expect(store.state).toBe("idle");
  });

  it("reports a manual check failure", async () => {
    checkMock.mockRejectedValue(new Error("unexpected deserialization failure"));
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_CHECK");
    expect(store.error?.message).toBe("unexpected deserialization failure");
    expect(store.lastCheckFailed).toBe(true);
  });

  it("swallows errors during a silent check", async () => {
    checkMock.mockRejectedValue(new Error("offline"));
    const store = new UpdateStore();

    await expect(store.check({ silent: true })).resolves.toBe(false);

    expect(store.state).toBe("idle");
    expect(store.error).toBeNull();
    expect(store.lastCheckFailed).toBe(true);
    expect(store.lastChecked).not.toBeNull();
  });

  it("persists a signature failure from a silent check", async () => {
    checkMock.mockRejectedValue(new Error("Signature verification failed"));
    const store = new UpdateStore();

    await expect(store.check({ silent: true })).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_SECURITY");
    expect(store.securityBlocked).toBe(true);
    expect(store.lastCheckFailed).toBe(true);
  });

  it("keeps a known update when a silent check fails", async () => {
    checkMock
      .mockResolvedValueOnce(asUpdate(fakeUpdate()))
      .mockRejectedValueOnce(new Error("offline"));
    const store = new UpdateStore();

    await store.check();
    await store.check({ silent: true });

    expect(store.state).toBe("available");
    expect(store.available?.version).toBe("0.2.0");
    expect(store.error).toBeNull();
  });

  it("follows the Rust progress events and relaunches after install", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    const store = new UpdateStore();
    await store.check();
    const observed: Array<number | null> = [];
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      emitProgress(40, 100);
      observed.push(store.progress);
      emitProgress(70, 100);
      observed.push(store.progress);
      emitProgress(100, 100);
      observed.push(store.progress);
      return { version: update.version, installed: true };
    }) as never);

    await expect(store.install()).resolves.toBe(true);

    expect(observed).toEqual([0.4, 0.7, 1]);
    expect(store.state).toBe("ready");
    expect(store.progress).toBe(1);
    expect(store.percent).toBe(100);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(listenMock).toHaveBeenCalledWith(
      UPDATE_PROGRESS_EVENT,
      expect.any(Function),
    );
    expect(unlistenMock).toHaveBeenCalledTimes(1);
  });

  it("stops engine sidecars before asking the shell to install", async () => {
    const order: string[] = [];
    invokeMock.mockImplementation((async (command: string) => {
      order.push(command);
      if (command === "prepare_update") {
        return 0;
      }
      return { version: "0.2.0", installed: true };
    }) as never);
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(true);

    // A running sidecar keeps the installed engine locked, so the shell must
    // stop it before the installer touches any file.
    expect(order).toEqual(["prepare_update", "update_install"]);
  });

  it("does not stop engine sidecars on a mere check", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    const store = new UpdateStore();

    await store.check();
    await store.check({ silent: true });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(store.state).toBe("available");
  });

  it("blocks the install when the engine sidecar cannot be stopped", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    invokeMock.mockRejectedValue({
      code: "ENGINE_STOP_FAILED",
      message: "engine sidecar 4242 is still running; close it before installing",
      details: null,
    });
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_ENGINE_BUSY");
    expect(store.error?.message).toContain("still running");
    expect(store.progress).toBeNull();
    expect(commands()).not.toContain("update_install");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("keeps an unknown download size indeterminate", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    const store = new UpdateStore();
    await store.check();
    const observed: Array<number | null> = [];
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      emitProgress(40, null);
      observed.push(store.progress);
      return { version: "0.2.0", installed: true };
    }) as never);

    await store.install();

    expect(observed).toEqual([null]);
    expect(store.progress).toBe(1);
  });

  it("reports an install failure without relaunching", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      throw { code: "UPDATE_INSTALL", message: "installer failed" };
    }) as never);
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_INSTALL");
    expect(store.error?.message).toBe("installer failed");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("treats a shell-side cancellation as a no-op, not an error", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      throw {
        code: "UPDATE_CANCELLED",
        message: "the update download was cancelled",
      };
    }) as never);
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("idle");
    expect(store.error).toBeNull();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("keeps the update ready when the restart fails", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    relaunchMock.mockRejectedValueOnce(new Error("cannot restart"));
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("ready");
    expect(store.error?.code).toBe("UPDATE_RESTART");

    relaunchMock.mockResolvedValueOnce(undefined);
    await expect(store.install()).resolves.toBe(true);
    expect(relaunchMock).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight download and returns to idle", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementation(((command: string) => {
      if (command === "prepare_update") {
        return Promise.resolve(0);
      }
      if (command === "update_install") {
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(true);
    }) as never);
    const store = new UpdateStore();
    await store.check();

    const installing = store.install();
    expect(store.state).toBe("downloading");
    await vi.waitFor(() =>
      expect(commands()).toContain("update_install"),
    );

    await store.cancel();
    expect(store.state).toBe("idle");
    expect(store.available).toBeNull();
    expect(commands()).toContain("update_cancel");
    expect(update.close).toHaveBeenCalledTimes(1);

    finish({ version: "0.2.0", installed: true });
    await expect(installing).resolves.toBe(false);
    expect(store.state).toBe("idle");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("never relaunches after the panel was dismissed mid-download", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    let finish!: (value: unknown) => void;
    invokeMock.mockImplementation(((command: string) => {
      if (command === "prepare_update") {
        return Promise.resolve(0);
      }
      if (command === "update_install") {
        return new Promise((resolve) => {
          finish = resolve;
        });
      }
      return Promise.resolve(true);
    }) as never);
    const store = new UpdateStore();
    await store.check();

    const installing = store.install();
    await vi.waitFor(() => expect(progressHandler).not.toBeNull());
    store.dismiss();
    expect(store.state).toBe("idle");

    finish({ version: "0.2.0", installed: true });
    await expect(installing).resolves.toBe(false);
    expect(store.state).toBe("idle");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("does not claim a cancellation once the installer started", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    invokeMock.mockImplementation(((command: string) => {
      if (command === "prepare_update") {
        return Promise.resolve(0);
      }
      if (command === "update_install") {
        // The installer is running; the promise never resolves.
        return new Promise(() => {});
      }
      if (command === "update_cancel") {
        return Promise.resolve(false);
      }
      return Promise.resolve(0);
    }) as never);
    const store = new UpdateStore();
    await store.check();

    void store.install();
    await vi.waitFor(() => expect(commands()).toContain("update_install"));
    await store.cancel();

    // The shell said the install cannot be cancelled: the panel stays honest
    // instead of pretending the click stopped it.
    expect(store.state).toBe("downloading");
    expect(store.available).not.toBeNull();
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("refuses to install without a pending release", async () => {
    const store = new UpdateStore();
    await expect(store.install()).resolves.toBe(false);
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("disables checking and installing in a portable build", async () => {
    const store = new UpdateStore();
    store.setPortable(true);

    expect(store.canAutoUpdate).toBe(false);
    await expect(store.check()).resolves.toBe(false);
    await expect(store.check({ silent: true })).resolves.toBe(false);
    await expect(store.install()).resolves.toBe(false);

    expect(checkMock).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(store.state).toBe("idle");
  });

  it.each(["deb", "rpm", "msi", "unknown"])(
    "disables in-app updates for the %s bundle",
    async (bundleKind) => {
      const store = new UpdateStore();
      store.setBundleKind(bundleKind);

      expect(store.canAutoUpdate).toBe(false);
      await expect(store.check()).resolves.toBe(false);
      expect(checkMock).not.toHaveBeenCalled();
      expect(store.state).toBe("idle");
    },
  );

  it.each(["appimage", "nsis", "app"])(
    "keeps in-app updates for the %s bundle",
    (bundleKind) => {
      const store = new UpdateStore();
      store.setBundleKind(bundleKind);
      expect(store.canAutoUpdate).toBe(true);
    },
  );

  it.each([
    "Could not fetch a valid release JSON from the remote",
    "the platform `windows-x86_64-nsis` was not found in the response `platforms` object",
    "TargetNotFound",
  ])("treats a missing platform artifact as unsupported: %s", async (message) => {
    checkMock.mockRejectedValue(new Error(message));
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(false);

    expect(store.state).toBe("unsupported");
    expect(store.available).toBeNull();
    expect(store.error).toBeNull();
  });

  it("marks a manual network failure as offline", async () => {
    checkMock.mockRejectedValue(new Error("error sending request: connection timed out"));
    const store = new UpdateStore();

    await expect(store.check()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_OFFLINE");
    expect(store.lastCheckFailed).toBe(true);
  });

  it("blocks a bad signature and never retries the install", async () => {
    checkMock.mockResolvedValue(asUpdate(fakeUpdate()));
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      throw new Error("Signature verification failed");
    }) as never);
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_SECURITY");
    expect(store.securityBlocked).toBe(true);
    expect(store.progress).toBeNull();
    expect(relaunchMock).not.toHaveBeenCalled();

    await expect(store.install()).resolves.toBe(false);
    expect(commands().filter((command) => command === "update_install")).toHaveLength(1);
  });

  it("persists a signature failure across store instances", async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    };
    vi.stubGlobal("localStorage", storage);
    try {
      const update = fakeUpdate("0.2.1");
      checkMock.mockResolvedValue(asUpdate(update));
      invokeMock.mockImplementation((async (command: string) => {
        if (command === "prepare_update") {
          return 0;
        }
        throw new Error("Signature verification failed");
      }) as never);
      const store = new UpdateStore();
      await store.check();
      await store.install();
      expect(store.blockedVersion).toBe("0.2.1");

      const restarted = new UpdateStore();
      expect(restarted.securityBlocked).toBe(true);
      expect(restarted.blockedVersion).toBe("0.2.1");

      checkMock.mockResolvedValue(asUpdate(fakeUpdate("0.2.2")));
      await expect(restarted.check()).resolves.toBe(true);
      expect(restarted.securityBlocked).toBe(false);
      expect(data.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the security block after dismiss and clears it for a new version", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    invokeMock.mockImplementation((async (command: string) => {
      if (command === "prepare_update") {
        return 0;
      }
      throw new Error("minisign: bad signature");
    }) as never);
    const store = new UpdateStore();
    await store.check();
    await store.install();

    store.dismiss();

    expect(store.securityBlocked).toBe(true);
    expect(store.blockedVersion).toBe(update.version);
    expect(store.state).toBe("error");

    // The same artifact is not offered again.
    checkMock.mockResolvedValue(asUpdate(fakeUpdate(update.version)));
    await expect(store.check()).resolves.toBe(false);
    expect(store.securityBlocked).toBe(true);

    // A different release is a new artifact and may be verified.
    checkMock.mockResolvedValue(asUpdate(fakeUpdate("9.9.9")));
    await expect(store.check()).resolves.toBe(true);
    expect(store.securityBlocked).toBe(false);
    expect(store.blockedVersion).toBeNull();
  });

  it("closes the pending release on dismiss", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    const store = new UpdateStore();
    await store.check();

    store.dismiss();

    expect(store.state).toBe("idle");
    expect(store.available).toBeNull();
    expect(store.progress).toBeNull();
    expect(update.close).toHaveBeenCalledTimes(1);
  });
});
