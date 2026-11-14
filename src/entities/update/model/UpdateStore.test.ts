import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));

import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { UpdateStore } from "./UpdateStore";

const getVersionMock = vi.mocked(getVersion);
const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

function fakeUpdate(version = "0.2.0") {
  return {
    version,
    date: "2026-11-14T10:00:00Z",
    body: "Fixes\nFaster",
    close: vi.fn(async () => {}),
    downloadAndInstall: vi.fn(
      async (_onEvent?: (event: DownloadEvent) => void) => {},
    ),
  };
}

function asUpdate(update: ReturnType<typeof fakeUpdate>): Update {
  return update as unknown as Update;
}

describe("UpdateStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getVersionMock.mockResolvedValue("0.1.0");
    relaunchMock.mockResolvedValue(undefined);
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

  it("accumulates download progress and relaunches after install", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    const store = new UpdateStore();
    await store.check();
    const observed: Array<number | null> = [];
    update.downloadAndInstall.mockImplementation(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      observed.push(store.progress);
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      observed.push(store.progress);
      onEvent?.({ event: "Progress", data: { chunkLength: 30 } });
      observed.push(store.progress);
      onEvent?.({ event: "Finished" });
      observed.push(store.progress);
    });

    await expect(store.install()).resolves.toBe(true);

    expect(observed).toEqual([0, 0.4, 0.7, 1]);
    expect(store.state).toBe("ready");
    expect(store.progress).toBe(1);
    expect(store.percent).toBe(100);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps an unknown download size indeterminate", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    const store = new UpdateStore();
    await store.check();
    const observed: Array<number | null> = [];
    update.downloadAndInstall.mockImplementation(async (onEvent) => {
      onEvent?.({ event: "Started", data: {} });
      observed.push(store.progress);
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      observed.push(store.progress);
    });

    await store.install();

    expect(observed).toEqual([null, null]);
    expect(store.progress).toBe(1);
  });

  it("reports an install failure without relaunching", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    update.downloadAndInstall.mockRejectedValue(new Error("installer failed"));
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_INSTALL");
    expect(store.error?.message).toBe("installer failed");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("keeps the update ready when the restart fails", async () => {
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
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
    const store = new UpdateStore();
    await store.check();
    let finish!: () => void;
    update.downloadAndInstall.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );

    const installing = store.install();
    expect(store.state).toBe("downloading");

    store.dismiss();
    expect(store.state).toBe("idle");
    expect(store.available).toBeNull();
    expect(update.close).toHaveBeenCalledTimes(1);

    finish();
    await expect(installing).resolves.toBe(false);
    expect(store.state).toBe("idle");
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
    const update = fakeUpdate();
    checkMock.mockResolvedValue(asUpdate(update));
    update.downloadAndInstall.mockRejectedValue(
      new Error("Signature verification failed"),
    );
    const store = new UpdateStore();
    await store.check();

    await expect(store.install()).resolves.toBe(false);

    expect(store.state).toBe("error");
    expect(store.error?.code).toBe("UPDATE_SECURITY");
    expect(store.securityBlocked).toBe(true);
    expect(store.progress).toBeNull();
    expect(relaunchMock).not.toHaveBeenCalled();

    await expect(store.install()).resolves.toBe(false);
    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
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
      update.downloadAndInstall.mockRejectedValue(
        new Error("Signature verification failed"),
      );
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
    update.downloadAndInstall.mockRejectedValue(new Error("minisign: bad signature"));
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
