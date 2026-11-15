import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { pickConfig } from "@/entities/engine/api/shell";

const invokeMock = vi.mocked(invoke);

describe("pickConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the shell-owned picker command instead of the dialog plugin", async () => {
    invokeMock.mockResolvedValue("C:\\workspace\\seo.toml");

    expect(await pickConfig()).toBe("C:\\workspace\\seo.toml");
    expect(invokeMock).toHaveBeenCalledWith("pick_config");
  });

  it("returns null when the user cancels", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await pickConfig()).toBeNull();
  });

  it("rejects an empty selection as a cancel", async () => {
    invokeMock.mockResolvedValue("   ");
    expect(await pickConfig()).toBeNull();
  });
});
