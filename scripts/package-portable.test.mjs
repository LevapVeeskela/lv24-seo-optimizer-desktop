import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { cleanupTempDirs, runScript, tempDir, writeText } from "./release-fixtures.mjs";

afterAll(cleanupTempDirs);

const TARGET = "x86_64-pc-windows-msvc";
const PRODUCT_DIR = "LV24 SEO Optimizer";

function archiveToolAvailable() {
  const probe =
    process.platform === "win32"
      ? spawnSync("tar", ["--version"], { stdio: "ignore", windowsHide: true })
      : spawnSync("zip", ["-v"], { stdio: "ignore" });
  return !probe.error && probe.status === 0;
}

function portableFixture() {
  const root = tempDir("portable");
  const exe = writeText(root, "build/lv24-seo-desktop.exe", "MZ fixture shell");
  const engineDir = join(root, "engine", "lv24-seo");
  writeText(engineDir, "lv24-seo.exe", "fixture engine");
  writeText(engineDir, "_internal/base_library.zip", "fixture runtime");
  const buildInfo = writeText(
    root,
    "engine/build-info.json",
    JSON.stringify({ name: "lv24-seo", version: "0.5.2" }),
  );
  return {
    root,
    exe,
    engineDir,
    buildInfo,
    stageRoot: join(root, "release", "portable"),
    zipPath: join(root, "release", "out", "LV24-SEO-Optimizer_0.7.0_x64-portable.zip"),
  };
}

function packageArgs(fixture, extra = []) {
  return [
    "--target",
    TARGET,
    "--exe",
    fixture.exe,
    "--engine-dir",
    fixture.engineDir,
    "--build-info",
    fixture.buildInfo,
    "--stage-root",
    fixture.stageRoot,
    "--output",
    fixture.zipPath,
    "--skip-probe",
    ...extra,
  ];
}

describe("package-portable", () => {
  it("stages the documented portable layout next to the sidecar", () => {
    const fixture = portableFixture();

    const result = runScript("package-portable.mjs", packageArgs(fixture, ["--skip-zip"]));

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`staged: ${join(fixture.stageRoot, PRODUCT_DIR)}`);

    const stageDir = join(fixture.stageRoot, PRODUCT_DIR);
    expect(readFileSync(join(stageDir, "lv24-seo-desktop.exe"), "utf8")).toBe("MZ fixture shell");
    expect(existsSync(join(stageDir, "lv24-seo", "lv24-seo.exe"))).toBe(true);
    expect(existsSync(join(stageDir, "lv24-seo", "_internal", "base_library.zip"))).toBe(true);
    expect(statSync(join(stageDir, "LICENSE")).size).toBeGreaterThan(0);
    expect(JSON.parse(readFileSync(join(stageDir, "engine-build-info.json"), "utf8")).version).toBe(
      "0.5.2",
    );

    const readme = readFileSync(join(stageDir, "README.txt"), "utf8");
    expect(readme).toContain("LV24 SEO Optimizer Desktop 0.7.0");
    expect(readme).toContain("Engine: lv24-seo 0.5.2");
    expect(readme).toContain("Verify the SHA-256 checksum published with the release");
    expect(readme).toContain("\r\n");
  });

  it("fails when the staged sidecar tree has no executable", () => {
    const fixture = portableFixture();
    const emptyEngine = join(fixture.root, "empty-engine");
    writeText(emptyEngine, "README.txt", "no executable here");

    const result = runScript("package-portable.mjs", [
      "--target",
      TARGET,
      "--exe",
      fixture.exe,
      "--engine-dir",
      emptyEngine,
      "--build-info",
      fixture.buildInfo,
      "--stage-root",
      fixture.stageRoot,
      "--output",
      fixture.zipPath,
      "--skip-probe",
      "--skip-zip",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sidecar executable not found");
  });

  it.skipIf(!archiveToolAvailable())(
    "writes the portable ZIP and a matching .sha256 sidecar",
    () => {
      const fixture = portableFixture();

      const result = runScript("package-portable.mjs", packageArgs(fixture));

      expect(result.status).toBe(0);
      expect(existsSync(fixture.zipPath)).toBe(true);
      const zipBytes = readFileSync(fixture.zipPath);
      expect(zipBytes.length).toBeGreaterThan(0);

      const sha256Path = `${fixture.zipPath}.sha256`;
      expect(existsSync(sha256Path)).toBe(true);
      const expected = createHash("sha256").update(zipBytes).digest("hex");
      expect(readFileSync(sha256Path, "utf8")).toBe(`${expected}  ${basename(fixture.zipPath)}\n`);
      expect(result.stdout).toContain(`sha256: ${expected}`);
    },
  );
});
