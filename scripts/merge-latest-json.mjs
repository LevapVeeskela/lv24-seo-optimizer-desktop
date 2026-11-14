#!/usr/bin/env node
/**
 * Merge per-platform updater metadata into a Tauri static `latest.json`.
 *
 * Input: flat `dist/` produced by download-artifact after
 * `scripts/stage-release-assets.mjs` ran on every matrix job.
 *
 * Required generic platform keys:
 *   windows-x86_64, linux-x86_64, darwin-aarch64, darwin-x86_64
 *
 * The Tauri updater plugin looks up `{os}-{arch}-{installer}` first and then
 * `{os}-{arch}`. We therefore add the aliases it supports:
 *   windows-x86_64-nsis, linux-x86_64-appimage, darwin-*-app
 * and, only when Tauri signed those bundles:
 *   linux-x86_64-deb, linux-x86_64-rpm
 *
 * URLs always use the staged, dotted asset basename, never the product name
 * with spaces.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const GENERIC_PLATFORMS = [
  "windows-x86_64",
  "linux-x86_64",
  "darwin-aarch64",
  "darwin-x86_64",
];
const ALIAS_PLATFORMS = [
  "windows-x86_64-nsis",
  "linux-x86_64-appimage",
  "linux-x86_64-deb",
  "linux-x86_64-rpm",
  "darwin-aarch64-app",
  "darwin-x86_64-app",
];
const ALL_PLATFORMS = new Set([...GENERIC_PLATFORMS, ...ALIAS_PLATFORMS]);

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

function fail(message) {
  console.error(`merge-latest-json: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readRepoFromCargo() {
  try {
    const cargo = readFileSync(join(root, "src-tauri", "Cargo.toml"), "utf8");
    const match = /^repository\s*=\s*"([^"]+)"/m.exec(cargo);
    if (!match) return "";
    const url = match[1].replace(/^git\+/, "");
    const github = /^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url);
    return github ? github[1] : "";
  } catch {
    return "";
  }
}

const dist = resolve(root, valueAfter("--dist", "dist"));
if (!existsSync(dist)) fail(`dist directory not found: ${dist}`);

const tag = valueAfter("--tag", process.env.RELEASE_TAG || "");
if (!tag) fail("--tag is required (for example --tag v0.2.0)");
if (!/^v\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(tag)) {
  fail(`tag must look like vX.Y.Z; got ${JSON.stringify(tag)}`);
}

const version = valueAfter("--version", tag.slice(1));
if (version !== tag.slice(1)) {
  fail(`version ${JSON.stringify(version)} does not match tag ${JSON.stringify(tag)}`);
}

const repo = valueAfter(
  "--repo",
  process.env.GITHUB_REPOSITORY || readRepoFromCargo(),
);
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  fail(`--repo must be owner/name; got ${JSON.stringify(repo)}`);
}

const out = resolve(root, valueAfter("--out", join(dist, "latest.json")));
const pubDate = valueAfter(
  "--pub-date",
  new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
);
if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(pubDate)) {
  fail(`--pub-date must be RFC3339 UTC ending in Z; got ${JSON.stringify(pubDate)}`);
}

const files = readdirSync(dist)
  .filter((name) => statSync(join(dist, name)).isFile())
  .sort();
const fileSet = new Set(files);

function validateSignature(label, signature) {
  if (typeof signature !== "string" || signature.trim() === "") {
    fail(`${label}: signature is empty`);
  }
  const trimmed = signature.trim();
  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    fail(`${label}: signature is not a single base64 value`);
  }
  if (trimmed.length < 64) {
    fail(`${label}: signature is unexpectedly short (${trimmed.length} chars)`);
  }
  return trimmed;
}

function checkPlatformAsset(platform, asset, label) {
  if (platform === "linux-x86_64-deb" && !asset.endsWith(".deb")) {
    fail(`${label}: expected a .deb asset, got ${asset}`);
  }
  if (platform === "linux-x86_64-rpm" && !asset.endsWith(".rpm")) {
    fail(`${label}: expected a .rpm asset, got ${asset}`);
  }
  if (platform.startsWith("darwin-") && !asset.endsWith(".app.tar.gz")) {
    fail(`${label}: expected a .app.tar.gz asset, got ${asset}`);
  }
  if (platform === "windows-x86_64-nsis" && !/\.(nsis\.zip|exe)$/.test(asset)) {
    fail(`${label}: expected a .nsis.zip or .exe asset, got ${asset}`);
  }
  if (platform === "linux-x86_64-appimage" && !/\.(AppImage\.tar\.gz|AppImage)$/.test(asset)) {
    fail(`${label}: expected an .AppImage.tar.gz or .AppImage asset, got ${asset}`);
  }
}

const metadata = new Map();
for (const name of files) {
  if (!/^updater-.*\.json$/.test(name)) continue;
  let data;
  try {
    data = readJson(join(dist, name));
  } catch (error) {
    fail(`${name}: invalid JSON (${error.message})`);
  }
  const platform = data.platform;
  if (!ALL_PLATFORMS.has(platform)) {
    fail(`${name}: unknown platform ${JSON.stringify(platform)}`);
  }
  if (metadata.has(platform)) {
    fail(`duplicate updater metadata for ${platform}: ${metadata.get(platform).file} and ${name}`);
  }
  if (name !== `updater-${platform}.json`) {
    console.warn(`merge-latest-json: note: ${name} declares platform ${platform}`);
  }
  metadata.set(platform, { file: name, data });
}

const problems = [];
for (const platform of GENERIC_PLATFORMS) {
  if (!metadata.has(platform)) problems.push(`missing updater metadata for ${platform}`);
}
for (const platform of ["linux-x86_64-deb", "linux-x86_64-rpm"]) {
  const hasSignature = files.some((name) => name.endsWith(platform === "linux-x86_64-deb" ? ".deb.sig" : ".rpm.sig"));
  if (hasSignature && !metadata.has(platform)) {
    problems.push(`${platform}: signature exists but updater-${platform}.json is missing`);
  }
  if (metadata.has(platform) && !hasSignature) {
    problems.push(`${platform}: updater-${platform}.json exists but the signature file is missing`);
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}

for (const [platform, entry] of metadata) {
  const { file, data } = entry;
  if (data.version !== version) {
    fail(`${file}: version ${JSON.stringify(data.version)} != ${version}`);
  }
  if (typeof data.asset !== "string" || basename(data.asset) !== data.asset) {
    fail(`${file}: asset must be a basename`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(data.asset)) {
    fail(`${file}: asset contains characters GitHub may rewrite`);
  }
  if (!fileSet.has(data.asset)) {
    fail(`${file}: asset ${data.asset} is not present in ${dist}`);
  }
  checkPlatformAsset(platform, data.asset, file);
  const signaturePath = join(dist, `${data.asset}.sig`);
  if (!existsSync(signaturePath)) {
    fail(`${file}: signature file ${data.asset}.sig is missing`);
  }
  const signature = validateSignature(file, data.signature);
  const onDisk = validateSignature(`${data.asset}.sig`, readFileSync(signaturePath, "utf8"));
  if (signature !== onDisk) {
    fail(`${file}: signature does not match ${data.asset}.sig`);
  }
  data.signature = signature;
}

function generic(platform) {
  const entry = metadata.get(platform);
  if (!entry) fail(`missing updater metadata for ${platform}`);
  return entry.data;
}

const windows = generic("windows-x86_64");
const linux = generic("linux-x86_64");
const darwinArm = generic("darwin-aarch64");
const darwinX64 = generic("darwin-x86_64");

// Aliases that share the generic asset must not drift from it.
for (const [alias, genericData] of [
  ["windows-x86_64-nsis", windows],
  ["linux-x86_64-appimage", linux],
  ["darwin-aarch64-app", darwinArm],
  ["darwin-x86_64-app", darwinX64],
]) {
  if (!metadata.has(alias)) continue;
  const aliasData = metadata.get(alias).data;
  if (aliasData.asset !== genericData.asset || aliasData.signature !== genericData.signature) {
    fail(`${alias} must reference the same asset and signature as its generic platform`);
  }
}

function requireCount(regex, expected, label) {
  const matches = files.filter((name) => regex.test(name));
  if (matches.length !== expected) {
    fail(`${label}: expected ${expected} file(s) matching ${regex}, found ${matches.length}${matches.length ? ` (${matches.join(", ")})` : ""}`);
  }
  return matches;
}

// Windows: Tauri 2.12.4 boolean mode signs the setup exe itself; v1Compatible
// produces .nsis.zip. Prefer the signed setup exe when both are present.
const nsisArchives = files.filter((name) => name.endsWith(".nsis.zip"));
const nsisSignatures = files.filter((name) => name.endsWith(".nsis.zip.sig"));
const setupExes = requireCount(/-setup\.exe$/, 1, "Windows NSIS installer");
const setupSignatures = files.filter((name) => /-setup\.exe\.sig$/.test(name));
if (setupSignatures.length === 1) {
  if (!windows.asset.endsWith(".exe")) {
    fail(`Windows updater metadata points to ${windows.asset}, expected the signed setup .exe`);
  }
} else if (nsisArchives.length === 1 && nsisSignatures.length === 1) {
  if (!windows.asset.endsWith(".nsis.zip")) {
    fail(`Windows updater metadata points to ${windows.asset}, expected .nsis.zip`);
  }
} else {
  fail(
    `Windows updater: expected setup.exe.sig or one .nsis.zip + .nsis.zip.sig, found ${setupSignatures.length} setup signature(s), ${nsisArchives.length} .nsis.zip, ${nsisSignatures.length} .nsis.zip.sig`,
  );
}

// Linux: Tauri 2.12.4 boolean mode signs the AppImage itself; v1Compatible
// produces AppImage.tar.gz. Prefer the signed AppImage when both are present.
const appImages = requireCount(/\.AppImage$/, 1, "Linux AppImage");
const debs = requireCount(/\.deb$/, 1, "Linux deb package");
const rpms = requireCount(/\.rpm$/, 1, "Linux rpm package");
const appImageArchives = files.filter((name) => name.endsWith(".AppImage.tar.gz"));
const appImageArchiveSignatures = files.filter((name) => name.endsWith(".AppImage.tar.gz.sig"));
const appImageSignatures = files.filter((name) => /\.AppImage\.sig$/.test(name));
if (appImageSignatures.length === 1) {
  if (!linux.asset.endsWith(".AppImage")) {
    fail(`Linux updater metadata points to ${linux.asset}, expected the signed AppImage`);
  }
} else if (appImageArchives.length === 1 && appImageArchiveSignatures.length === 1) {
  if (!linux.asset.endsWith(".AppImage.tar.gz")) {
    fail(`Linux updater metadata points to ${linux.asset}, expected .AppImage.tar.gz`);
  }
} else {
  fail(
    `Linux updater: expected AppImage.sig or one .AppImage.tar.gz + .AppImage.tar.gz.sig, found ${appImageSignatures.length} AppImage signature(s), ${appImageArchives.length} .AppImage.tar.gz, ${appImageArchiveSignatures.length} .AppImage.tar.gz.sig`,
  );
}

// macOS: two DMGs and two updater archives, one per architecture.
const dmgs = requireCount(/\.dmg$/, 2, "macOS DMG");
requireCount(/\.app\.tar\.gz$/, 2, "macOS updater archive");
requireCount(/\.app\.tar\.gz\.sig$/, 2, "macOS updater signature");
if (!dmgs.some((name) => name.includes("_aarch64.dmg"))) {
  fail(`macOS DMGs: no arm64 DMG in ${dmgs.join(", ")}`);
}
if (!dmgs.some((name) => name.includes("_x64.dmg"))) {
  fail(`macOS DMGs: no x64 DMG in ${dmgs.join(", ")}`);
}
if (!darwinArm.asset.includes(`_${version}_aarch64.app.tar.gz`)) {
  fail(`darwin-aarch64 updater asset ${darwinArm.asset} does not contain the aarch64 versioned stem`);
}
if (!darwinX64.asset.includes(`_${version}_x64.app.tar.gz`)) {
  fail(`darwin-x86_64 updater asset ${darwinX64.asset} does not contain the x64 versioned stem`);
}

// Cross-check that the updater asset maps back to the installer a user runs.
const setupForWindows = windows.asset.replace(/\.nsis\.zip$/, ".exe");
if (windows.asset.endsWith(".nsis.zip") && !fileSet.has(setupForWindows)) {
  fail(`Windows updater ${windows.asset} has no matching ${setupForWindows}`);
}
const appImageForLinux = linux.asset.replace(/\.tar\.gz$/, "");
if (!fileSet.has(appImageForLinux)) {
  fail(`Linux updater ${linux.asset} has no matching ${appImageForLinux}`);
}
const dmgForArm = darwinArm.asset.replace(/\.app\.tar\.gz$/, ".dmg");
const dmgForX64 = darwinX64.asset.replace(/\.app\.tar\.gz$/, ".dmg");
if (!fileSet.has(dmgForArm) || !fileSet.has(dmgForX64)) {
  fail(`macOS updater archives have no matching DMGs (${dmgForArm}, ${dmgForX64})`);
}

function platformEntry(data) {
  return {
    signature: data.signature,
    url: `https://github.com/${repo}/releases/download/${tag}/${data.asset}`,
  };
}

const platforms = {};
for (const platform of GENERIC_PLATFORMS) platforms[platform] = platformEntry(generic(platform));

// Bundle-specific aliases the plugin probes before the generic key. Synthesize
// the ones that always share the generic asset; deb/rpm come from real metadata.
platforms["windows-x86_64-nsis"] = platformEntry(metadata.get("windows-x86_64-nsis")?.data ?? windows);
platforms["linux-x86_64-appimage"] = platformEntry(metadata.get("linux-x86_64-appimage")?.data ?? linux);
platforms["darwin-aarch64-app"] = platformEntry(metadata.get("darwin-aarch64-app")?.data ?? darwinArm);
platforms["darwin-x86_64-app"] = platformEntry(metadata.get("darwin-x86_64-app")?.data ?? darwinX64);
if (metadata.has("linux-x86_64-deb")) {
  platforms["linux-x86_64-deb"] = platformEntry(metadata.get("linux-x86_64-deb").data);
} else {
  console.warn(
    "merge-latest-json: warning: no deb signature/metadata; a deb install falls back to linux-x86_64 (AppImage asset)",
  );
}
if (metadata.has("linux-x86_64-rpm")) {
  platforms["linux-x86_64-rpm"] = platformEntry(metadata.get("linux-x86_64-rpm").data);
} else {
  console.warn(
    "merge-latest-json: warning: no rpm signature/metadata; an rpm install falls back to linux-x86_64 (AppImage asset)",
  );
}

let notes = valueAfter("--notes", "");
if (!notes) {
  const notesFile = valueAfter(
    "--notes-file",
    join(root, "docs", "releases", `${version}.md`),
  );
  if (existsSync(notesFile)) {
    notes = readFileSync(notesFile, "utf8").trim();
  } else if (valueAfter("--notes-file", "")) {
    fail(`notes file not found: ${notesFile}`);
  }
}
if (!notes) notes = `LV24 SEO Optimizer Desktop ${version}`;

const latest = {
  version,
  notes,
  pub_date: pubDate,
  platforms,
};
writeFileSync(out, `${JSON.stringify(latest, null, 2)}\n`, "utf8");

console.log(`wrote:     ${out}`);
console.log(`version:   ${version}`);
console.log(`repo:      ${repo}`);
console.log(`tag:       ${tag}`);
console.log(`pub_date:  ${pubDate}`);
for (const [platform, entry] of Object.entries(platforms)) {
  console.log(`${platform.padEnd(26)} ${entry.url}`);
}
