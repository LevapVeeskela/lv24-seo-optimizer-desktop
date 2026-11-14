import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

function textareaStub() {
  return {
    value: "",
    setAttribute: vi.fn(),
    style: {} as Record<string, string>,
    focus: vi.fn(),
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
}

describe("copyText", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports failure when neither the clipboard nor a document exists", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", undefined);

    await expect(copyText("hello")).resolves.toBe(false);
  });

  it("uses the async clipboard when it is available", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to a textarea when the clipboard is denied", async () => {
    const area = textareaStub();
    const appendChild = vi.fn();
    const execCommand = vi.fn(() => true);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => area),
      body: { appendChild },
      execCommand,
    });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(area.value).toBe("hello");
    expect(appendChild).toHaveBeenCalledWith(area);
    expect(area.remove).toHaveBeenCalledTimes(1);
  });

  it("reports failure when the textarea fallback is refused", async () => {
    const area = textareaStub();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => false),
    });

    await expect(copyText("hello")).resolves.toBe(false);
    expect(area.remove).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the copy control after the textarea fallback", async () => {
    class FakeElement {
      isConnected = true;
      focus = vi.fn();
    }
    const previous = new FakeElement();
    const area = textareaStub();
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      activeElement: previous,
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => true),
    });

    await expect(copyText("hello")).resolves.toBe(true);
    expect(previous.focus).toHaveBeenCalledTimes(1);
  });

  it("removes the textarea when execCommand throws", async () => {
    const area = textareaStub();
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      createElement: vi.fn(() => area),
      body: { appendChild: vi.fn() },
      execCommand: vi.fn(() => {
        throw new Error("unsupported");
      }),
    });

    await expect(copyText("hello")).resolves.toBe(false);
    expect(area.setSelectionRange).toHaveBeenCalledWith(0, 5);
    expect(area.remove).toHaveBeenCalledTimes(1);
  });
});
