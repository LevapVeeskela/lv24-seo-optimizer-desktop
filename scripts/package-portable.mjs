#!/usr/bin/env node
/**
 * Package the Windows desktop as a portable ZIP.
 *
 * Layout inside the archive:
 *   LV24 SEO Optimizer/
 *     lv24-seo-desktop.exe
 *     lv24-seo/lv24-seo.exe + _internal/
 *     LICENSE
 *     README.txt
 *
 * The shell resolves a sibling `lv24-seo/lv24-seo.exe`, so this layout works
 * without installation. The NSIS installer is produced by `tauri build`.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

const target = valueAfter("--target", "");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const targetLabel = target.startsWith("x86_64")
  ? "x64"
  : target.startsWith("aarch64")
    ? "arm64"
    : target || "x64";
const productDir = "LV24 SEO Optimizer";
const stageRoot = join(root, "release", "portable");
const stageDir = join(stageRoot, productDir);
const zipPath = resolve(
  root,
  valueAfter("--output", join("release", `LV24-SEO-Optimizer_${version}_${targetLabel}-portable.zip`)),
);

function fail(message) {
  console.error(`package-portable: ${message}`);
  process.exit(1);
}

function firstExisting(paths) {
  return paths.find((path) => existsSync(path)) ?? null;
}

const exe = firstExisting([
  valueAfter("--exe", ""),
  target ? join(root, "src-tauri", "target", target, "release", "lv24-seo-desktop.exe") : "",
  join(root, "src-tauri", "target", "release", "lv24-seo-desktop.exe"),
].filter(Boolean));
if (!exe) fail("lv24-seo-desktop.exe not found; run `npm run tauri build -- --bundles nsis` first");

const engineDir = firstExisting([
  join(root, "src-tauri", "engine", "lv24-seo"),
  join(root, "src-tauri", "engine", "lv24-seo", "lv24-seo"),
]);
if (!engineDir) fail("sidecar not found; run `python scripts/build-sidecar.py` first");

const engineExe = join(engineDir, "lv24-seo.exe");
if (!existsSync(engineExe)) fail(`sidecar executable not found: ${engineExe}`);

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });
cpSync(exe, join(stageDir, "lv24-seo-desktop.exe"));
cpSync(engineDir, join(stageDir, "lv24-seo"), { recursive: true });
cpSync(join(root, "LICENSE"), join(stageDir, "LICENSE"));

const buildInfo = join(root, "src-tauri", "engine", "build-info.json");
if (existsSync(buildInfo)) cpSync(buildInfo, join(stageDir, "engine-build-info.json"));

writeFileSync(
  join(stageDir, "README.txt"),
  [
    "LV24 SEO Optimizer Desktop " + version,
    "",
    "Portable build. Extract the whole folder and run lv24-seo-desktop.exe.",
    "The bundled lv24-seo engine is in the lv24-seo subfolder; keep it next to the app.",
    "",
    "This build is unsigned. Windows SmartScreen or antivirus software may warn.",
    "Verify the SHA-256 checksum published with the release before running.",
    "",
    "The app is local and offline-first. It reads a seo.toml selected in Settings",
    "and never uploads data by itself. See README.md in the repository for details.",
    "",
    "Engine: lv24-seo " + readEngineVersion(),
  ].join("\r\n"),
  "utf8",
);

function readEngineVersion() {
  try {
    const info = JSON.parse(readFileSync(buildInfo, "utf8"));
    return String(info.version || "unknown");
  } catch {
    return "unknown";
  }
}

const probe = spawnSync(engineExe, ["version", "--json"], {
  cwd: stageDir,
  encoding: "utf8",
  timeout: 60000,
  windowsHide: true,
});
if (probe.error || probe.status !== 0) {
  fail(`sidecar version check failed: ${probe.error?.message ?? probe.stderr}`);
}
const line = (probe.stdout || "").trim().split(/\r?\n/).filter(Boolean).pop();
const payload = line ? JSON.parse(line) : null;
if (payload?.ok !== true) fail("sidecar version check did not return ok=true");
console.log(`sidecar: lv24-seo ${payload.data.version}`);

if (has("--skip-zip")) {
  console.log(`staged: ${stageDir}`);
  process.exit(0);
}

mkdirSync(dirname(zipPath), { recursive: true });
rmSync(zipPath, { force: true });
if (process.platform === "win32") {
  // bsdtar ships with Windows 10+ and writes forward-slash entry names.
  // Compress-Archive writes backslashes, which strict extractors treat as
  // literal filename characters.
  const result = spawnSync("tar", ["-a", "-c", "-f", zipPath, "-C", stageRoot, productDir], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) fail("tar.exe failed to create the portable ZIP");
} else {
  const result = spawnSync("zip", ["-r", "-q", zipPath, productDir], {
    cwd: stageRoot,
    stdio: "inherit",
  });
  if (result.status !== 0) fail("zip failed; install the `zip` command");
}

const bytes = statSync(zipPath).size;
const sha256 = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
writeFileSync(`${zipPath}.sha256`, `${sha256}  ${zipPath.split(/[\\/]/).pop()}\n`, "utf8");
console.log(`zip:    ${zipPath}`);
console.log(`size:   ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
console.log(`sha256: ${sha256}`);
