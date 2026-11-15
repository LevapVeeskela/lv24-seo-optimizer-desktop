/**
 * Fixture helpers for the release-script tests (`scripts/*.test.mjs`).
 *
 * Every helper works in a fresh directory under the OS temp dir, so a test can
 * never touch the repository's `dist/` or `release/`. The fixture mirrors what
 * `scripts/stage-release-assets.mjs` leaves in `release/` after the four matrix
 * jobs, which is exactly the input `merge-latest-json.mjs` and the release job
 * receive.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
export const REPO = "LevapVeeskela/lv24-seo-optimizer-desktop";

const created = [];

export function tempDir(prefix = "release") {
  const dir = mkdtempSync(join(tmpdir(), `lv24-seo-${prefix}-`));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs() {
  for (const dir of created.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

export function writeText(dir, name, content) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}

/** Base64 that passes the scripts' signature checks; unique per label. */
export function fakeSignature(label) {
  return Buffer.from(String(label).padEnd(72, ".")).toString("base64");
}

export function runScript(name, args, options = {}) {
  const result = spawnSync(process.execPath, [join(repoRoot, "scripts", name), ...args], {
    encoding: "utf8",
    cwd: repoRoot,
    windowsHide: true,
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

/**
 * Build a flat `dist/` fixture equivalent to a staged four-platform release.
 *
 * `windows` and `linux` select the Tauri updater variant so the fallback
 * branches of the merge script stay covered.
 */
export function makeReleaseDist({
  version = "0.2.2",
  windows = "setup",
  linux = "appimage",
  debSignature = true,
  rpmSignature = true,
} = {}) {
  const dir = tempDir("dist");
  const stem = `LV24.SEO.Optimizer_${version}`;
  const files = [];

  const put = (name, content = "fixture-binary") => {
    writeText(dir, name, content);
    files.push(name);
    return name;
  };
  const sign = (asset) => put(`${asset}.sig`, `${fakeSignature(asset)}\n`);
  const manifest = (platform, asset) =>
    put(
      `updater-${platform}.json`,
      `${JSON.stringify({ platform, asset, signature: fakeSignature(asset), version }, null, 2)}\n`,
    );

  const setup = `${stem}_x64-setup.exe`;
  put(setup);
  if (windows === "setup") {
    sign(setup);
    manifest("windows-x86_64", setup);
    manifest("windows-x86_64-nsis", setup);
  } else {
    const nsis = `${stem}_x64-setup.nsis.zip`;
    put(nsis);
    sign(nsis);
    manifest("windows-x86_64", nsis);
    manifest("windows-x86_64-nsis", nsis);
  }

  const appImage = `${stem}_amd64.AppImage`;
  put(appImage);
  if (linux === "appimage") {
    sign(appImage);
    manifest("linux-x86_64", appImage);
    manifest("linux-x86_64-appimage", appImage);
  } else {
    const archive = `${stem}_amd64.AppImage.tar.gz`;
    put(archive);
    sign(archive);
    manifest("linux-x86_64", archive);
    manifest("linux-x86_64-appimage", archive);
  }

  const deb = `${stem}_amd64.deb`;
  put(deb);
  if (debSignature) {
    sign(deb);
    manifest("linux-x86_64-deb", deb);
  }

  const rpm = `${stem}_amd64.rpm`;
  put(rpm);
  if (rpmSignature) {
    sign(rpm);
    manifest("linux-x86_64-rpm", rpm);
  }

  for (const arch of ["aarch64", "x64"]) {
    put(`${stem}_${arch}.dmg`);
    const archive = `${stem}_${arch}.app.tar.gz`;
    put(archive);
    sign(archive);
    const platform = arch === "aarch64" ? "darwin-aarch64" : "darwin-x86_64";
    manifest(platform, archive);
    manifest(`${platform}-app`, archive);
  }

  return {
    dir,
    version,
    files,
    path: (name) => join(dir, name),
    put,
    remove(name) {
      const path = join(dir, name);
      if (!existsSync(path)) throw new Error(`fixture file not found: ${name}`);
      rmSync(path);
    },
    overwrite(name, content) {
      writeText(dir, name, content);
    },
  };
}

export function mergeArgs(dist, overrides = {}) {
  const args = [
    "--dist",
    dist,
    "--out",
    join(dist, "latest.json"),
    "--tag",
    "v0.2.2",
    "--repo",
    REPO,
    "--notes",
    "Fixture notes",
    "--pub-date",
    "2026-11-15T00:00:00Z",
  ];
  for (const [flag, value] of Object.entries(overrides)) {
    const index = args.indexOf(`--${flag}`);
    if (index >= 0) args.splice(index, 2, `--${flag}`, value);
    else args.push(`--${flag}`, value);
  }
  return args;
}

/** Run the merge script and return its result plus the parsed manifest. */
export function mergeLatestJson(dist, overrides = {}) {
  const result = runScript("merge-latest-json.mjs", mergeArgs(dist, overrides));
  const manifestPath = resolve(dist, "latest.json");
  return {
    ...result,
    manifestPath,
    manifest: existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : null,
  };
}
