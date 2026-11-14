#!/usr/bin/env node
/**
 * Verify a built lv24-seo PyInstaller sidecar against the reviewed pin.
 *
 * Checks: target exists, executable exists, `version --json` matches the pinned
 * engine, and SHA-256/size match the pinned values. Placeholder hashes (null)
 * warn by default and fail with --require-pinned. Use --write to pin a verified
 * build.
 *
 * PyInstaller onedir output is not byte-reproducible, so a CI rebuild cannot
 * match the reviewed pin. `--no-hash` (alias `--allow-rebuild`) still verifies
 * the target, executable and engine version, but records the actual SHA-256 and
 * turns a hash/size mismatch into a warning. The default stays strict for local
 * release verification.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const scriptRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function usage(message, code = 2) {
  if (message) console.error(`verify-sidecar: ${message}`);
  console.error(
    "usage: node scripts/verify-sidecar.mjs --target <triple> [--root src-tauri/engine] " +
      "[--engine-version X] [--manifest scripts/cli-checksums.json] [--exe path] " +
      "[--report file] [--json] [--write] [--require-pinned] [--no-hash] [--no-exec] [--timeout ms]",
  );
  process.exit(code);
}

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
function valueAfter(flag, fallback) {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) usage(`${flag} requires a value`);
  return value;
}

const valueFlags = new Set([
  "--root",
  "--target",
  "--engine-version",
  "--manifest",
  "--exe",
  "--report",
  "--timeout",
]);
const booleanFlags = new Set([
  "--json",
  "--write",
  "--require-pinned",
  "--no-hash",
  "--allow-rebuild",
  "--no-exec",
  "--help",
  "-h",
]);
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (valueFlags.has(arg)) {
    index += 1;
    continue;
  }
  if (booleanFlags.has(arg)) continue;
  if ([...valueFlags].some((flag) => arg.startsWith(`${flag}=`))) continue;
  usage(`unknown argument ${arg}`);
}

if (has("--help") || has("-h")) usage(undefined, 0);

function readArg(flag, fallback) {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  return valueAfter(flag, fallback);
}

const root = resolve(scriptRoot, readArg("--root", "src-tauri/engine"));
const manifestPath = resolve(scriptRoot, readArg("--manifest", "scripts/cli-checksums.json"));
const target = readArg("--target", "");
const exeOverride = readArg("--exe", "");
const reportPath = readArg("--report", "");
const requirePinned = has("--require-pinned");
const allowRebuild = has("--no-hash") || has("--allow-rebuild");
const noExec = has("--no-exec");
const writePin = has("--write");
const jsonMode = has("--json");
const timeout = Number.parseInt(readArg("--timeout", "30000"), 10);

if (!target) usage("--target is required");
if (!Number.isFinite(timeout) || timeout <= 0) usage("--timeout must be a positive integer");
if (writePin && allowRebuild) usage("--write cannot be combined with --no-hash/--allow-rebuild");
if (!existsSync(manifestPath)) {
  console.error(`verify-sidecar: missing manifest ${manifestPath}`);
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (error) {
  console.error(`verify-sidecar: invalid manifest: ${error.message}`);
  process.exit(1);
}

const expectedVersion = readArg("--engine-version", String(manifest.version ?? ""));
if (!expectedVersion) {
  console.error("verify-sidecar: manifest has no version; pass --engine-version");
  process.exit(1);
}
const entry = manifest.targets?.[target];
if (!entry || typeof entry !== "object") {
  console.error(
    `verify-sidecar: target ${target} is not in ${relative(scriptRoot, manifestPath)}; ` +
      `known: ${Object.keys(manifest.targets ?? {}).join(", ")}`,
  );
  process.exit(1);
}
if (typeof entry.path !== "string" || !entry.path) {
  console.error(`verify-sidecar: target ${target} has no executable path`);
  process.exit(1);
}

function findExecutable() {
  if (exeOverride) {
    return isAbsolute(exeOverride) ? exeOverride : resolve(root, exeOverride);
  }
  const fromRoot = resolve(root, entry.path);
  if (existsSync(fromRoot)) return fromRoot;
  // Also accept --root pointing at the lv24-seo directory itself.
  const nested = resolve(root, basename(entry.path));
  if (existsSync(nested)) return nested;
  return fromRoot;
}

const executable = findExecutable();
const errors = [];
const warnings = [];
let size = null;
let sha256 = null;
let actualVersion = null;
let pinned = false;
let hashMatched = null;
let sizeMatched = null;
let pinnedSha256 = null;

if (!existsSync(executable)) {
  errors.push(`executable not found: ${executable}`);
} else {
  const stat = statSync(executable);
  if (!stat.isFile()) errors.push(`not a file: ${executable}`);
  size = stat.size;
  if (size <= 0) errors.push("executable is empty");
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function runVersion() {
  const env = {
    ...process.env,
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
    NO_COLOR: "1",
    TERM: "dumb",
    LV24_SEO_ALLOW_FILE_SECRETS: "0",
  };
  const result = spawnSync(executable, ["version", "--json"], {
    cwd: tmpdir(),
    env,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    shell: false,
  });
  if (result.error) {
    errors.push(`could not run version --json: ${result.error.message}`);
    return;
  }
  if (result.status !== 0) {
    errors.push(`version --json exited ${result.status}`);
  }
  const lines = (result.stdout ?? "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    errors.push(`version --json produced no output${result.stderr ? `: ${result.stderr.slice(0, 300)}` : ""}`);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(lines[lines.length - 1]);
  } catch (error) {
    errors.push(`version --json is not JSON: ${error.message}`);
    return;
  }
  if (payload?.ok !== true) {
    errors.push("version --json returned ok=false");
    return;
  }
  actualVersion = payload?.data?.version ?? null;
  if (payload?.data?.name !== "lv24-seo") {
    errors.push(`unexpected engine name: ${JSON.stringify(payload?.data?.name)}`);
  }
  if (actualVersion !== expectedVersion) {
    errors.push(`engine version ${JSON.stringify(actualVersion)} != pinned ${expectedVersion}`);
  }
}

if (errors.length === 0 && !noExec) runVersion();
if (errors.length === 0 && noExec) warnings.push("version check skipped by --no-exec");

if (errors.length === 0) {
  sha256 = await hashFile(executable);
  const pinnedHash = typeof entry.sha256 === "string" ? entry.sha256.toLowerCase() : null;
  if (writePin) {
    entry.sha256 = sha256;
    entry.size = size;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    pinned = true;
    hashMatched = true;
    warnings.push(`pinned ${target} sha256 in ${relative(scriptRoot, manifestPath)}`);
  } else if (pinnedHash && /^[a-f0-9]{64}$/.test(pinnedHash)) {
    pinnedSha256 = pinnedHash;
    if (pinnedHash === sha256) {
      pinned = true;
      hashMatched = true;
    } else if (allowRebuild) {
      hashMatched = false;
      warnings.push(
        `sha256 differs from the reviewed pin (built ${sha256}, pinned ${pinnedHash}); ` +
          "accepted by --no-hash because PyInstaller output is not byte-reproducible",
      );
    } else {
      hashMatched = false;
      errors.push(`sha256 mismatch: built ${sha256}, pinned ${pinnedHash}`);
    }
  } else {
    warnings.push("sha256 is not pinned (null placeholder)");
    if (requirePinned) errors.push("--require-pinned was requested but the hash is a placeholder");
  }
  if (entry.size !== null && Number.isInteger(entry.size)) {
    sizeMatched = entry.size === size;
    if (!sizeMatched) {
      const message = `size mismatch: built ${size}, pinned ${entry.size}`;
      if (allowRebuild) warnings.push(`${message}; accepted by --no-hash`);
      else errors.push(message);
    }
  }
}

const ok = errors.length === 0;
const report = {
  schemaVersion: 1,
  engine: manifest.engine ?? "lv24-seo",
  target,
  executable: relative(scriptRoot, executable).replaceAll("\\", "/"),
  expectedVersion,
  actualVersion,
  size,
  sha256,
  pinnedSha256,
  hashPolicy: allowRebuild ? "rebuild" : "strict",
  hashMatched,
  sizeMatched,
  pinned,
  ok,
  errors,
  warnings,
};

if (reportPath) {
  const resolvedReport = resolve(scriptRoot, reportPath);
  mkdirSync(dirname(resolvedReport), { recursive: true });
  writeFileSync(resolvedReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

if (jsonMode) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  console.log(`target:    ${target}`);
  console.log(`executable:${executable}`);
  console.log(`version:   ${actualVersion ?? "not checked"} (pinned ${expectedVersion})`);
  console.log(`sha256:    ${sha256 ?? "not computed"}`);
  console.log(`size:      ${size ?? "unknown"} bytes`);
  console.log(`policy:    ${allowRebuild ? "rebuild (hash/size mismatch warns)" : "strict (hash/size mismatch fails)"}`);
  console.log(`pinned:    ${pinned ? "yes" : "no"}`);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  for (const error of errors) console.error(`error: ${error}`);
}

process.exit(ok ? 0 : 1);
