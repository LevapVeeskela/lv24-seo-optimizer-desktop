import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { cliRun } from "@/shared/cli";
import {
  loadAuthStatus,
  openOAuthUrl,
  runAuthLogin,
} from "./ipc";

const CONFIG = "C:\\ws\\seo.toml";

describe("connectors ipc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cliRun).mockResolvedValue({
      ok: true,
      data: {},
      meta: {},
      warnings: [],
    });
    vi.mocked(invoke).mockResolvedValue("https://oauth.yandex.ru/authorize?x=1");
  });

  it("runs Google with provider only, no noBrowser and no code", async () => {
    await runAuthLogin({ provider: "gsc" }, CONFIG);
    expect(cliRun).toHaveBeenCalledWith("auth_login", {
      args: { provider: "gsc" },
      configPath: CONFIG,
    });
  });

  it("asks for the Yandex URL without exchanging a code", async () => {
    await runAuthLogin({ provider: "yandex", urlOnly: true }, CONFIG);
    expect(cliRun).toHaveBeenCalledWith("auth_login", {
      args: { provider: "yandex", urlOnly: true },
      configPath: CONFIG,
    });
  });

  it("exchanges a pasted code for Metrika", async () => {
    await runAuthLogin({ provider: "metrika", code: "abc123" }, CONFIG);
    expect(cliRun).toHaveBeenCalledWith("auth_login", {
      args: { provider: "metrika", code: "abc123" },
      configPath: CONFIG,
    });
  });

  it("reads auth status with and without a workspace config", async () => {
    await loadAuthStatus(CONFIG);
    expect(cliRun).toHaveBeenCalledWith("auth_status", {
      configPath: CONFIG,
    });
    await loadAuthStatus(null);
    expect(cliRun).toHaveBeenLastCalledWith("auth_status", {});
  });

  it("opens only through the narrow Rust opener", async () => {
    const url = "https://oauth.yandex.ru/authorize?response_type=code";
    vi.mocked(invoke).mockResolvedValue(url);
    await expect(openOAuthUrl(url)).resolves.toBe(url);
    expect(invoke).toHaveBeenCalledWith("open_oauth_url", { url });
  });
});
