import { describe, expect, it, vi } from "vitest";
import {
  installCloseGuard,
  type CloseGuardEvent,
  type CloseGuardWindow,
} from "./closeGuard";

type Handler = (event: CloseGuardEvent) => void | Promise<void>;

function fakeWindow() {
  let handler: Handler | null = null;
  const unlisten = vi.fn(() => {
    handler = null;
  });
  const close = vi.fn(async () => {});
  const window: CloseGuardWindow = {
    onCloseRequested: async (next) => {
      handler = next;
      return unlisten;
    },
    close,
  };
  return {
    window,
    close,
    unlisten,
    emit: async () => {
      const preventDefault = vi.fn();
      await handler?.({ preventDefault });
      return preventDefault;
    },
  };
}

describe("installCloseGuard", () => {
  it("does not block a clean draft", async () => {
    const fake = fakeWindow();
    const confirmDiscard = vi.fn(async () => true);
    const discard = vi.fn();
    await installCloseGuard(fake.window, {
      isDirty: () => false,
      confirmDiscard,
      discard,
    });

    const preventDefault = await fake.emit();

    expect(preventDefault).not.toHaveBeenCalled();
    expect(confirmDiscard).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
  });

  it("keeps the window open when the user keeps editing", async () => {
    const fake = fakeWindow();
    const discard = vi.fn();
    await installCloseGuard(fake.window, {
      isDirty: () => true,
      confirmDiscard: async () => false,
      discard,
    });

    const preventDefault = await fake.emit();

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(discard).not.toHaveBeenCalled();
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.unlisten).not.toHaveBeenCalled();
  });

  it("discards, unlistens and closes exactly once after confirmation", async () => {
    const fake = fakeWindow();
    const discard = vi.fn();
    await installCloseGuard(fake.window, {
      isDirty: () => true,
      confirmDiscard: async () => true,
      discard,
    });

    await fake.emit();
    await fake.emit();

    expect(discard).toHaveBeenCalledTimes(1);
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.close).toHaveBeenCalledTimes(1);
    // `close()` must not re-enter the guard and ask a second time.
    expect(fake.unlisten.mock.invocationCallOrder[0]).toBeLessThan(
      fake.close.mock.invocationCallOrder[0],
    );
  });

  it("reports a close failure instead of throwing into the event loop", async () => {
    const fake = fakeWindow();
    fake.close.mockRejectedValueOnce(new Error("destroy denied"));
    const onError = vi.fn();
    await installCloseGuard(fake.window, {
      isDirty: () => true,
      confirmDiscard: async () => true,
      discard: () => {},
      onError,
    });

    await fake.emit();

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("unregisters when the returned disposer runs", async () => {
    const fake = fakeWindow();
    const confirmDiscard = vi.fn(async () => true);
    const dispose = await installCloseGuard(fake.window, {
      isDirty: () => true,
      confirmDiscard,
      discard: () => {},
    });

    dispose();
    await fake.emit();

    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(confirmDiscard).not.toHaveBeenCalled();
  });
});
