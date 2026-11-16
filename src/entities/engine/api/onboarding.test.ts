import { describe, expect, it, vi } from "vitest";

vi.mock("@/shared/cli", () => ({ cliRun: vi.fn() }));

import { cliRun } from "@/shared/cli";
import { initProject } from "./onboarding";

const runMock = vi.mocked(cliRun);

describe("initProject", () => {
  it("passes the contract paths through the allow-listed CLI bridge", async () => {
    runMock.mockResolvedValue({
      ok: true,
      data: {
        config_path: "/srv/site/seo.toml",
        data_dir: "/srv/site/data",
        overwritten: false,
        project: {},
      },
      meta: {},
      warnings: [],
    });

    await initProject({
      property: "https://example.com",
      configPath: "/srv/site/seo.toml",
      dataDir: "/srv/site/data",
    });

    expect(runMock).toHaveBeenCalledWith("init", {
      configPath: "/srv/site/seo.toml",
      args: {
        property: "https://example.com",
        dataDir: "/srv/site/data",
      },
    });
  });
});
