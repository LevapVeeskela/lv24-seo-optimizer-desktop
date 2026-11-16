import { describe, expect, it, vi } from "vitest";
import {
  bindSaveShortcut,
  hasOpenModal,
  isSaveShortcut,
  type SaveShortcutEvent,
} from "./shortcut";

const base: SaveShortcutEvent = {
  key: "s",
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
};

describe("isSaveShortcut", () => {
  it("accepts Ctrl+S and Cmd+S regardless of key case", () => {
    expect(isSaveShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isSaveShortcut({ ...base, metaKey: true })).toBe(true);
    expect(isSaveShortcut({ ...base, key: "S", ctrlKey: true })).toBe(true);
  });

  it("leaves plain and modified S to the platform", () => {
    expect(isSaveShortcut(base)).toBe(false);
    expect(isSaveShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isSaveShortcut({ ...base, ctrlKey: true, altKey: true })).toBe(false);
    expect(isSaveShortcut({ ...base, key: "p", ctrlKey: true })).toBe(false);
  });

  it("ignores repeats, IME composition and already handled events", () => {
    expect(isSaveShortcut({ ...base, ctrlKey: true, repeat: true })).toBe(false);
    expect(isSaveShortcut({ ...base, ctrlKey: true, isComposing: true })).toBe(false);
    expect(
      isSaveShortcut({ ...base, ctrlKey: true, defaultPrevented: true }),
    ).toBe(false);
  });
});

describe("hasOpenModal", () => {
  it("detects a modal dialog and tolerates a missing document", () => {
    expect(hasOpenModal({ querySelector: () => ({}) })).toBe(true);
    expect(hasOpenModal({ querySelector: () => null })).toBe(false);
    expect(hasOpenModal(null)).toBe(false);
  });
});

describe("bindSaveShortcut", () => {
  function fakeTarget() {
    let listener: ((event: KeyboardEvent) => void) | null = null;
    const addEventListener = vi.fn(
      (_type: "keydown", next: (event: KeyboardEvent) => void) => {
        listener = next;
      },
    );
    const removeEventListener = vi.fn(() => {
      listener = null;
    });
    return {
      target: { addEventListener, removeEventListener },
      dispatch: (event: KeyboardEvent) => listener?.(event),
      get listening() {
        return listener !== null;
      },
    };
  }

  function keyEvent(overrides: Partial<SaveShortcutEvent> = {}): KeyboardEvent {
    const preventDefault = vi.fn();
    return {
      key: "s",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault,
      ...overrides,
    } as unknown as KeyboardEvent;
  }

  it("saves and prevents the browser default on Ctrl+S", () => {
    const fake = fakeTarget();
    const onSave = vi.fn();
    bindSaveShortcut(fake.target, onSave);
    const event = keyEvent();

    fake.dispatch(event);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ignores plain S and an open modal", () => {
    const fake = fakeTarget();
    const onSave = vi.fn();
    bindSaveShortcut(fake.target, onSave, () => false);

    fake.dispatch(keyEvent({ ctrlKey: false }));
    expect(onSave).not.toHaveBeenCalled();

    const blocked = fakeTarget();
    bindSaveShortcut(blocked.target, onSave, () => true);
    blocked.dispatch(keyEvent());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("unbinds the listener", () => {
    const fake = fakeTarget();
    const unbind = bindSaveShortcut(fake.target, () => {});

    unbind();

    expect(fake.target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(fake.listening).toBe(false);
  });
});
