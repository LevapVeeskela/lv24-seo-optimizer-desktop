import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigReadResult } from "@/entities/config/model/types";

vi.mock("@/entities/config/api/configApi", () => ({
  configRead: vi.fn(),
  configValidate: vi.fn(),
  configWrite: vi.fn(),
  configPatch: vi.fn(),
  runDoctor: vi.fn(),
}));

import {
  configPatch,
  configRead,
  configValidate,
  configWrite,
} from "@/entities/config/api/configApi";
import { ConfigStore } from "@/entities/config/model/ConfigStore";

const readMock = vi.mocked(configRead);
const validateMock = vi.mocked(configValidate);
const patchMock = vi.mocked(configPatch);
const writeMock = vi.mocked(configWrite);

const RAW = `[project]
name = "example"
base_url = "https://example.com"
`;

const RAW_B = `[project]
name = "second"
base_url = "https://second.example"
`;

function readResult(path: string, raw: string): ConfigReadResult {
  return {
    path,
    raw,
    dataDir: "C:\\workspace\\data",
    resolvedPath: path,
    config: { project: { name: "effective" } },
    syntaxError: null,
    envelope: null,
    warnings: [],
    exitCode: 0,
    stderr: "",
    engineError: null,
  };
}

describe("ConfigStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads, tracks dirty state and discards", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    expect(await store.load("C:\\w\\seo.toml")).toBe(true);
    expect(store.state).toBe("ready");
    expect(store.draft?.project.name).toBe("example");
    expect(store.dirty).toBe(false);

    store.set("project.name", "changed");
    expect(store.draft?.project.name).toBe("changed");
    expect(store.dirty).toBe(true);

    store.discard();
    expect(store.draft?.project.name).toBe("example");
    expect(store.dirty).toBe(false);
  });

  it("ignores a stale load that resolves after a newer one", async () => {
    let resolveFirst!: (value: ConfigReadResult) => void;
    let resolveSecond!: (value: ConfigReadResult) => void;
    const first = new Promise<ConfigReadResult>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<ConfigReadResult>((resolve) => {
      resolveSecond = resolve;
    });
    readMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    const store = new ConfigStore();
    const loadFirst = store.load("C:\\a\\seo.toml");
    const loadSecond = store.load("C:\\b\\seo.toml");

    resolveSecond(readResult("C:\\b\\seo.toml", RAW_B));
    expect(await loadSecond).toBe(true);
    resolveFirst(readResult("C:\\a\\seo.toml", RAW));
    expect(await loadFirst).toBe(false);

    expect(store.path).toBe("C:\\b\\seo.toml");
    expect(store.draft?.project.name).toBe("second");
  });

  it("reports a syntax error without creating a draft", async () => {
    readMock.mockResolvedValue({
      ...readResult("C:\\w\\seo.toml", "not = [valid"),
      syntaxError: "unterminated array",
      config: null,
    });
    const store = new ConfigStore();
    expect(await store.load("C:\\w\\seo.toml")).toBe(false);
    expect(store.state).toBe("error");
    expect(store.draft).toBeNull();
    expect(store.loadError?.message).toContain("unterminated");
  });

  it("refuses to save a locally invalid draft", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("report.email.smtp_port", 0);
    expect(await store.save()).toBe(false);
    expect(patchMock).not.toHaveBeenCalled();
    expect(store.saveError?.code).toBe("CONFIG_INVALID");
    expect(store.fieldError("report.email.smtp_port")).toBeTruthy();
  });

  it("validates through the engine for a locally valid draft", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    validateMock.mockResolvedValue({
      path: "C:\\w\\seo.toml",
      valid: true,
      syntaxError: null,
      envelope: { ok: true, data: {}, meta: { redacted: true }, warnings: [] },
      exitCode: 0,
      stderr: "",
    });
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    expect(await store.validate()).toBe(true);
    expect(validateMock).toHaveBeenCalledTimes(1);
    const [path, content] = validateMock.mock.calls[0];
    expect(path).toBe("C:\\w\\seo.toml");
    expect(content).toContain('name = "example"');
    expect(store.validation?.valid).toBe(true);
  });

  it("does not call the engine when local validation fails", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("report.timezone", "");
    expect(await store.validate()).toBe(false);
    expect(validateMock).not.toHaveBeenCalled();
    expect(store.fieldError("report.timezone")).toBeTruthy();
  });

  it("saves field patches and records the backup", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    patchMock.mockResolvedValue({
      path: "C:\\w\\seo.toml",
      raw: RAW.replace('name = "example"', 'name = "new name"'),
      backup: "C:\\w\\seo.toml.bak-1",
      bytes: 42,
      config: { project: { name: "new name" } },
      warnings: [],
      engineError: null,
    });
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "new name");
    expect(await store.save()).toBe(true);
    expect(patchMock).toHaveBeenCalledTimes(1);
    const [path, patches] = patchMock.mock.calls[0];
    expect(path).toBe("C:\\w\\seo.toml");
    expect(patches).toEqual([{ path: "project.name", value: "new name" }]);
    expect(store.lastBackup).toBe("C:\\w\\seo.toml.bak-1");
    expect(store.backups).toEqual(["C:\\w\\seo.toml.bak-1"]);
    expect(store.dirty).toBe(false);
    expect(store.saved?.project.name).toBe("new name");
  });

  it("writes an explicit provider block for a presence-only change", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    patchMock.mockResolvedValue({
      path: "C:\\w\\seo.toml",
      raw: `${RAW}\n[providers.gsc]\nproperty = ""\nauth = "keychain"\n`,
      backup: "C:\\w\\seo.toml.bak-presence",
      bytes: 64,
      config: { project: { name: "example" } },
      warnings: [],
      engineError: null,
    });
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    // Re-setting the default value still marks the block as present.
    store.set("providers.gsc.property", "");
    expect(store.diff.map((item) => item.path)).toEqual([
      "providers.gsc.present",
    ]);

    expect(await store.save()).toBe(true);
    const [, patches] = patchMock.mock.calls[0];
    expect(patches).toEqual([
      { path: "providers.gsc.property", value: "" },
      { path: "providers.gsc.auth", value: "keychain" },
    ]);
    expect(patches.some((patch) => patch.path.endsWith(".present"))).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it("does not claim a save when there is nothing to write", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");

    expect(await store.save()).toBe(false);
    expect(patchMock).not.toHaveBeenCalled();
    expect(store.saveError?.code).toBe("CONFIG_NOTHING_TO_WRITE");
    expect(store.dirty).toBe(false);
    expect(store.saved).toEqual(store.draft);
  });

  it("falls back to full TOML when config_patch is unavailable", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    patchMock.mockRejectedValue({
      code: "UNKNOWN",
      message: "Command config_patch not found",
    });
    writeMock.mockResolvedValue({
      path: "C:\\w\\seo.toml",
      backup: "C:\\w\\seo.toml.bak-fallback",
      bytes: 100,
    });
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "fallback");
    expect(await store.save()).toBe(true);
    expect(writeMock).toHaveBeenCalledTimes(1);
    expect(writeMock.mock.calls[0][1]).toContain('name = "fallback"');
    expect(store.lastBackup).toBe("C:\\w\\seo.toml.bak-fallback");
    expect(store.usedFullWrite).toBe(true);
    expect(store.dirty).toBe(false);
  });

  it("keeps the draft when the patch fails", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    patchMock.mockRejectedValue({
      code: "CONFIG_INVALID",
      message: "engine rejected the draft",
    });
    validateMock.mockResolvedValue({
      path: "C:\\w\\seo.toml",
      valid: false,
      syntaxError: null,
      envelope: {
        ok: false,
        error: { code: "CONFIG_INVALID", message: "report.locale: invalid" },
        meta: {},
        warnings: [],
      },
      exitCode: 1,
      stderr: "",
    });
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "kept");
    expect(await store.save()).toBe(false);
    expect(store.draft?.project.name).toBe("kept");
    expect(store.saved?.project.name).toBe("example");
    expect(store.saveError?.message).toContain("engine rejected");
    expect(store.fieldError("report.locale")).toBeTruthy();
  });
});
