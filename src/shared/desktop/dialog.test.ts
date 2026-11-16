import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { pickDirectory } from "./dialog";

const invokeMock = vi.mocked(invoke);

describe("pickDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the shell-owned folder dialog", async () => {
    invokeMock.mockResolvedValue("C:\\work\\alpha");
    expect(await pickDirectory()).toBe("C:\\work\\alpha");
    expect(invokeMock).toHaveBeenCalledWith("pick_directory");
  });

  it("treats cancel and blank selections as null", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await pickDirectory()).toBeNull();
    invokeMock.mockResolvedValue("   ");
    expect(await pickDirectory()).toBeNull();
  });
});
