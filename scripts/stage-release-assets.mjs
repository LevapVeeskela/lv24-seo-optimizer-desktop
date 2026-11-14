#!/usr/bin/env node
/**
 * Stage Tauri bundles into a flat release/ directory.
 *
 * GitHub normalizes spaces in release asset names to dots. Staging normalizes
 * names before checksums and uploads so SHA256SUMS.txt always matches the
 * published asset. macOS updater archives need an extra rename: Tauri writes
 * `Product.app.tar.gz` without version or architecture, so the arm64 and x64
 * jobs would otherwise produce the same basename and overwrite each other when
 * artifacts are merged.
 *
 * Updater variants are detected from the files Tauri actually produced:
 *   Windows: *-setup.exe + *.exe.sig (preferred; Tauri 2.12.4 boolean mode),
 *            else *.nsis.zip + *.nsis.zip.sig (v1Compatible/older builds)
 *   macOS:   *.app.tar.gz + *.app.tar.gz.sig
 *   Linux:   *.AppImage + *.AppImage.sig (preferred; boolean mode),
 *            else *.AppImage.tar.gz + *.AppImage.tar.gz.sig (v1Compatible)
 *
 * Writes `release/updater-<platform>.json`:
 *   { "platform", "asset", "signature", "version" }
 * `signature` is the content of the `.sig` file, never a path.
 *
 * Linux also writes `updater-linux-x86_64-deb.json` and
 * `updater-linux-x86_64-rpm.json` only when Tauri produced `.deb.sig`/`.rpm.sig`.
 * Those aliases match the updater plugin's `{os}-{arch}-{installer}` lookup.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const TARGETS = {
  "x86_64-pc-windows-msvc": {
    platform: "windows-x86_64",
    os: "windows",
    arch: "x64",
  },
  "x86_64-unknown-linux-gnu": {
    platform: "linux-x86_64",
    os: "linux",
    arch: "amd64",
  },
  "aarch64-apple-darwin": {
    platform: "darwin-aarch64",
    os: "macos",
    arch: "aarch64",
  },
  "x86_64-apple-darwin": {
    platform: "darwin-x86_64",
    os: "macos",
    arch: "x64",
  },
};

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : fallback;
};

function fail(message) {
  console.error(`stage-release-assets: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPackageVersion() {
  return String(readJson(join(root, "package.json")).version);
}

function readProductName() {
  return String(readJson(join(root, "src-tauri", "tauri.conf.json")).productName);
}

/**
 * Match GitHub's dotted release asset form and refuse anything GitHub would
 * rewrite differently. The product name only contains spaces today, so this is
 * intentionally strict instead of guessing GitHub's full sanitizer.
 */
function normalizeAssetName(name) {
  const normalized = name.replace(/\s+/g, ".");
  if (!/^[A-Za-z0-9._-]+$/.test(normalized)) {
    fail(`asset name contains characters GitHub may rewrite: ${JSON.stringify(name)}`);
  }
  return normalized;
}

function walkFiles(dir) {
  if (!existsSync(dir)) fail(`bundle directory not found: ${dir}`);
  const result = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full));
    } else if (entry.isFile()) {
      result.push(full);
    }
  }
  return result;
}

function signatureFromFile(path) {
  const signature = readFileSync(path, "utf8").trim();
  if (!signature) fail(`signature file is empty: ${path}`);
  if (!/^[A-Za-z0-9+/=]+$/.test(signature)) {
    fail(`signature file is not a single base64 value: ${path}`);
  }
  if (signature.length < 64) {
    fail(`signature file is unexpectedly short (${signature.length} chars): ${path}`);
  }
  return signature;
}

const target = valueAfter("--target", "");
const targetInfo = TARGETS[target];
if (!targetInfo) {
  fail(
    `unsupported target ${JSON.stringify(target)}; expected one of ${Object.keys(TARGETS).join(", ")}`,
  );
}

const version = valueAfter("--version", readPackageVersion());
if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`version must be semver without a leading v; got ${JSON.stringify(version)}`);
}

const productName = valueAfter("--product-name", readProductName());
const bundleRoot = resolve(
  root,
  valueAfter("--bundle-root", join("src-tauri", "target", target, "release", "bundle")),
);
const outDir = resolve(root, valueAfter("--out", "release"));
const buildInfo = resolve(root, valueAfter("--build-info", join("src-tauri", "engine", "build-info.json")));
const requireUpdater = has("--require-updater");

const files = walkFiles(bundleRoot);
if (files.length === 0) fail(`no bundle files under ${bundleRoot}`);

const bySuffix = (suffix) => files.filter((file) => basename(file).endsWith(suffix));
const describe = (matches) => matches.map((file) => basename(file)).join(", ");

function exactlyOne(label, suffix) {
  const matches = bySuffix(suffix);
  if (matches.length !== 1) {
    fail(`${label}: expected exactly one *${suffix}, found ${matches.length}${matches.length ? ` (${describe(matches)})` : ""}`);
  }
  return matches[0];
}

function atMostOne(label, suffix) {
  const matches = bySuffix(suffix);
  if (matches.length > 1) {
    fail(`${label}: found multiple *${suffix}: ${describe(matches)}`);
  }
  return matches[0] ?? null;
}

/**
 * Choose the Windows updater asset the way the updater plugin can consume it.
 * Tauri 2.12.4 boolean mode signs the setup exe itself; v1Compatible/older
 * builds produce *.nsis.zip. Prefer the signed setup exe because it is the
 * artifact the local release build actually produced.
 */
function chooseWindowsUpdater(setupExe) {
  const nsisArchive = atMostOne("Windows updater archive", ".nsis.zip");
  const nsisSignature = atMostOne("Windows updater signature", ".nsis.zip.sig");
  const setupSignature = atMostOne("Windows setup signature", `${basename(setupExe)}.sig`);

  if (nsisSignature && !nsisArchive) {
    fail(`Windows updater: ${basename(nsisSignature)} has no .nsis.zip archive`);
  }
  if (setupSignature) {
    return {
      variant: "setup.exe",
      archive: setupExe,
      signatureFile: setupSignature,
      asset: normalizeAssetName(basename(setupExe)),
    };
  }
  if (nsisArchive && nsisSignature) {
    return {
      variant: "nsis.zip",
      archive: nsisArchive,
      signatureFile: nsisSignature,
      asset: normalizeAssetName(basename(nsisArchive)),
    };
  }
  if (nsisArchive && !nsisSignature) {
    fail(`Windows updater: ${basename(nsisArchive)} has no .nsis.zip.sig and no setup.exe.sig fallback`);
  }
  if (requireUpdater) {
    fail("Windows updater: neither setup.exe.sig nor .nsis.zip.sig was produced");
  }
  return null;
}

/**
 * Choose the Linux updater asset the way the updater plugin can consume it.
 * Tauri 2.12.4 boolean mode signs the AppImage itself; v1Compatible builds
 * produce *.AppImage.tar.gz. Prefer the signed AppImage because it is the
 * artifact the local release build actually produced.
 */
function chooseLinuxUpdater(appImage) {
  const tarArchive = atMostOne("Linux updater archive", ".AppImage.tar.gz");
  const tarSignature = atMostOne("Linux updater signature", ".AppImage.tar.gz.sig");
  const appImageSignature = atMostOne("Linux AppImage signature", `${basename(appImage)}.sig`);

  if (tarSignature && !tarArchive) {
    fail(`Linux updater: ${basename(tarSignature)} has no .AppImage.tar.gz archive`);
  }
  if (appImageSignature) {
    return {
      variant: "AppImage",
      archive: appImage,
      signatureFile: appImageSignature,
      asset: normalizeAssetName(basename(appImage)),
    };
  }
  if (tarArchive && tarSignature) {
    return {
      variant: "AppImage.tar.gz",
      archive: tarArchive,
      signatureFile: tarSignature,
      asset: normalizeAssetName(basename(tarArchive)),
    };
  }
  if (tarArchive && !tarSignature) {
    fail(`Linux updater: ${basename(tarArchive)} has no .AppImage.tar.gz.sig and no AppImage.sig fallback`);
  }
  if (requireUpdater) {
    fail("Linux updater: neither AppImage.sig nor .AppImage.tar.gz.sig was produced");
  }
  return null;
}

function chooseMacUpdater() {
  const archive = atMostOne("macOS updater archive", ".app.tar.gz");
  const signature = atMostOne("macOS updater signature", ".app.tar.gz.sig");
  if (signature && !archive) {
    fail(`macOS updater: ${basename(signature)} has no .app.tar.gz archive`);
  }
  if (archive && !signature) {
    fail(`macOS updater: ${basename(archive)} has no .app.tar.gz.sig`);
  }
  if (!archive && requireUpdater) {
    fail("macOS updater: no .app.tar.gz + .app.tar.gz.sig was produced");
  }
  return archive ? { variant: "app.tar.gz", archive, signatureFile: signature } : null;
}

let installers;
let updater;

if (targetInfo.os === "windows") {
  const setupExe = exactlyOne("Windows NSIS installer", "-setup.exe");
  installers = [setupExe];
  updater = chooseWindowsUpdater(setupExe);
} else if (targetInfo.os === "linux") {
  const appImage = exactlyOne("Linux AppImage", ".AppImage");
  const deb = exactlyOne("Linux deb package", ".deb");
  const rpm = exactlyOne("Linux rpm package", ".rpm");
  installers = [appImage, deb, rpm];
  updater = chooseLinuxUpdater(appImage);
} else {
  installers = [exactlyOne("macOS DMG", ".dmg")];
  updater = chooseMacUpdater();
}

if (!existsSync(buildInfo)) fail(`build info not found: ${buildInfo}`);

mkdirSync(outDir, { recursive: true });

const staged = [];
const stagedNames = new Set();
const stagedSources = new Map();
function stage(source, canonicalName) {
  if (stagedNames.has(canonicalName)) {
    const existing = stagedSources.get(canonicalName);
    if (resolve(existing) !== resolve(source)) {
      fail(`duplicate staged asset name ${canonicalName}: ${existing} and ${source}`);
    }
    return canonicalName;
  }
  copyFileSync(source, join(outDir, canonicalName));
  stagedNames.add(canonicalName);
  stagedSources.set(canonicalName, source);
  staged.push(canonicalName);
  return canonicalName;
}

function writeUpdaterMetadata(platform, asset, signature) {
  const metadata = { platform, asset, signature, version };
  writeFileSync(join(outDir, `updater-${platform}.json`), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return metadata;
}

for (const installer of installers) {
  stage(installer, normalizeAssetName(basename(installer)));
}

const metadataPaths = [join(outDir, `updater-${targetInfo.platform}.json`)];
if (targetInfo.os === "windows") {
  metadataPaths.push(join(outDir, "updater-windows-x86_64-nsis.json"));
} else if (targetInfo.os === "linux") {
  metadataPaths.push(
    join(outDir, "updater-linux-x86_64-appimage.json"),
    join(outDir, "updater-linux-x86_64-deb.json"),
    join(outDir, "updater-linux-x86_64-rpm.json"),
  );
} else {
  metadataPaths.push(join(outDir, `updater-${targetInfo.platform}-app.json`));
}
for (const metadataPath of metadataPaths) rmSync(metadataPath, { force: true });

const metadata = [];
if (updater) {
  let updaterName;
  if (targetInfo.os === "macos") {
    // Tauri names the macOS updater bundle `Product.app.tar.gz` with no version
    // or arch, which collides across the two macOS jobs. Use the same
    // product_version_arch stem as the DMG so both can live in one release.
    updaterName = normalizeAssetName(`${productName}_${version}_${targetInfo.arch}.app.tar.gz`);
  } else {
    updaterName = updater.asset;
  }

  const signature = signatureFromFile(updater.signatureFile);
  stage(updater.archive, updaterName);
  stage(updater.signatureFile, `${updaterName}.sig`);
  metadata.push(writeUpdaterMetadata(targetInfo.platform, updaterName, signature));
  updater.asset = updaterName;
  updater.signature = signature;
} else {
  console.warn(
    `stage-release-assets: warning: no updater artifacts for ${target}; publishing without updater metadata`,
  );
}

if (targetInfo.os === "linux") {
  // Tauri signs deb/rpm bundles when updater signing is enabled. Publish the
  // signatures and aliases only when they exist; the updater plugin prefers
  // `linux-x86_64-deb` / `linux-x86_64-rpm` over the generic AppImage entry.
  for (const [suffix, platform] of [
    [".deb", "linux-x86_64-deb"],
    [".rpm", "linux-x86_64-rpm"],
  ]) {
    const bundle = exactlyOne(platform === "linux-x86_64-deb" ? "Linux deb package" : "Linux rpm package", suffix);
    const signatureFile = atMostOne(`${platform} signature`, `${basename(bundle)}.sig`);
    if (!signatureFile) {
      console.warn(`stage-release-assets: warning: no ${suffix}.sig for ${basename(bundle)}; omitting ${platform}`);
      continue;
    }
    const asset = normalizeAssetName(basename(bundle));
    const signature = signatureFromFile(signatureFile);
    stage(bundle, asset);
    stage(signatureFile, `${asset}.sig`);
    metadata.push(writeUpdaterMetadata(platform, asset, signature));
  }
}

copyFileSync(buildInfo, join(outDir, `build-info-${target}.json`));

// package-portable.mjs stages a full copy of the app under release/portable.
// upload-artifact recurses into directories, so keep only flat release files.
rmSync(join(outDir, "portable"), { recursive: true, force: true });

console.log(`target:   ${target}`);
console.log(`platform: ${targetInfo.platform}`);
for (const name of staged) {
  const size = statSync(join(outDir, name)).size;
  console.log(`asset:    ${name} (${size} bytes)`);
}
console.log(`build:    build-info-${target}.json`);
if (updater) {
  console.log(`updater:  ${updater.asset} (${updater.variant}, signature ${updater.signature.length} chars)`);
} else {
  console.log("updater:  none");
}
for (const entry of metadata) {
  console.log(`manifest: updater-${entry.platform}.json -> ${entry.asset}`);
}
