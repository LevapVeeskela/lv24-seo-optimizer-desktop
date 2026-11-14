import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConfigPatchOutcome,
  ConfigReadResult,
  ConfigValidateResult,
} from "@/entities/config/model/types";

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
  runDoctor,
} from "@/entities/config/api/configApi";
import { ConfigStore } from "@/entities/config/model/ConfigStore";
import type { DoctorRun } from "@/entities/config/model/types";

const readMock = vi.mocked(configRead);
const validateMock = vi.mocked(configValidate);
const patchMock = vi.mocked(configPatch);
const writeMock = vi.mocked(configWrite);
const doctorMock = vi.mocked(runDoctor);

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

  it("surfaces an engine rejection from config_read immediately", async () => {
    readMock.mockResolvedValue({
      ...readResult("C:\\w\\seo.toml", RAW),
      config: null,
      envelope: {
        ok: false,
        error: {
          code: "CONFIG_INVALID",
          message: "project.base_url: must be an absolute URL",
          retryable: false,
        },
        meta: {},
        warnings: [],
      },
      engineError: {
        code: "CONFIG_INVALID",
        message: "project.base_url: must be an absolute URL",
        retryable: false,
      },
    });
    const store = new ConfigStore();

    expect(await store.load("C:\\w\\seo.toml")).toBe(true);

    expect(store.engineError?.code).toBe("CONFIG_INVALID");
    expect(store.engineError?.message).toContain("base_url");
    // The raw file still loads so the user can fix the rejected field.
    expect(store.draft?.project.name).toBe("example");
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

  it("clears warnings from the previous workspace when a new load fails", async () => {
    readMock.mockResolvedValueOnce({
      ...readResult("C:\\a\\seo.toml", RAW),
      warnings: ["old workspace warning"],
    });
    const store = new ConfigStore();
    expect(await store.load("C:\\a\\seo.toml")).toBe(true);
    expect(store.warnings).toEqual(["old workspace warning"]);

    readMock.mockRejectedValueOnce(new Error("file disappeared"));
    expect(await store.load("C:\\b\\seo.toml")).toBe(false);
    expect(store.warnings).toEqual([]);
    expect(store.allWarnings).toEqual([]);
    expect(store.state).toBe("error");
  });

  it("ignores doctor results that arrive after a workspace switch", async () => {
    readMock.mockResolvedValue(readResult("C:\\a\\seo.toml", RAW));
    let resolveDoctor!: (value: DoctorRun) => void;
    doctorMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDoctor = resolve;
      }),
    );

    const store = new ConfigStore();
    await store.load("C:\\a\\seo.toml");
    const doctor = store.runDoctor();

    await store.load("C:\\b\\seo.toml");
    resolveDoctor({
      ok: true,
      healthy: true,
      checks: [{ id: "config", ok: true, detail: "old workspace" }],
      message: null,
      meta: {},
      warnings: [],
      ranAt: "2026-11-14T12:00:00.000Z",
    });

    expect(await doctor).toBe(false);
    expect(store.doctor).toBeNull();
  });

  it("does not let a stale validation clear a newer validation flag", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "first");

    let resolveOld!: (value: ConfigValidateResult) => void;
    validateMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const oldValidation = store.validate();
    expect(store.validating).toBe(true);

    // A reload bumps the generation and clears the flag, then a newer
    // validation starts while the old request is still in flight.
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "second");
    let resolveNew!: (value: ConfigValidateResult) => void;
    validateMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNew = resolve;
      }),
    );
    const newValidation = store.validate();
    expect(store.validating).toBe(true);

    resolveOld({
      path: "C:\\w\\seo.toml",
      valid: true,
      syntaxError: null,
      envelope: { ok: true, data: {}, meta: {}, warnings: [] },
      exitCode: 0,
      stderr: "",
    });
    expect(await oldValidation).toBe(false);
    expect(store.validating).toBe(true);

    resolveNew({
      path: "C:\\w\\seo.toml",
      valid: true,
      syntaxError: null,
      envelope: { ok: true, data: {}, meta: {}, warnings: [] },
      exitCode: 0,
      stderr: "",
    });
    expect(await newValidation).toBe(true);
    expect(store.validating).toBe(false);
  });

  it("does not let a stale save clear a newer save flag", async () => {
    readMock.mockResolvedValue(readResult("C:\\w\\seo.toml", RAW));
    const store = new ConfigStore();
    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "first");

    let resolveOld!: (value: ConfigPatchOutcome) => void;
    patchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const oldSave = store.save();
    expect(store.saving).toBe(true);

    await store.load("C:\\w\\seo.toml");
    store.set("project.name", "second");
    let resolveNew!: (value: ConfigPatchOutcome) => void;
    patchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNew = resolve;
      }),
    );
    const newSave = store.save();
    expect(store.saving).toBe(true);

    const outcome = (name: string): ConfigPatchOutcome => ({
      path: "C:\\w\\seo.toml",
      raw: RAW.replace('name = "example"', `name = "${name}"`),
      backup: null,
      bytes: 1,
      config: { project: { name } },
      warnings: [],
      engineError: null,
    });
    resolveOld(outcome("first"));
    expect(await oldSave).toBe(false);
    expect(store.saving).toBe(true);

    resolveNew(outcome("second"));
    expect(await newSave).toBe(true);
    expect(store.saving).toBe(false);
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
