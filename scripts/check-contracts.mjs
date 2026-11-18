#!/usr/bin/env node
/**
 * Contract drift check for the desktop <-> lv24-seo boundary.
 *
 * Default mode regenerates the contracts with the pinned engine through `uv`
 * and fails when the committed bytes differ. `--static` only validates the
 * committed files and is useful without Python/uv. `--update` rewrites them.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contractsDir = join(root, "contracts");
const cliDir = join(contractsDir, "cli-v1");
const pinPath = join(root, "scripts", "cli-checksums.json");
const schemaPath = join(contractsDir, "config.schema.json");
const manifestPath = join(cliDir, "manifest.json");

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const update = has("--update");
const staticOnly = has("--static");
const engineVersionArg = valueAfter("--engine-version");

function fail(message) {
  console.error(`contract check: ${message}`);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`cannot read ${relative(root, path)}: ${error.message}`);
  }
}

function commandExists(command) {
  const probe = spawnSync(command, ["--version"], {
    cwd: root,
    stdio: "ignore",
    shell: false,
    windowsHide: true,
  });
  return !probe.error && probe.status === 0;
}

if (!existsSync(pinPath)) fail("missing scripts/cli-checksums.json");
const pin = readJson(pinPath);
if (typeof pin.version !== "string" || !pin.version) fail("pin is missing a version");
const engineVersion = engineVersionArg || pin.version;

function runGenerator(mode) {
  const base = ["scripts/gen-contracts.py", mode, "--engine-version", engineVersion];
  let command;
  let commandArgs;
  let label;

  if (commandExists("uv")) {
    const withArgs = [`lv24-seo[secrets]==${engineVersion}`];
    if (typeof pin.pydantic === "string" && pin.pydantic) {
      withArgs.push(`pydantic==${pin.pydantic}`);
    }
    if (typeof pin.typer === "string" && pin.typer) {
      withArgs.push(`typer==${pin.typer}`);
    }
    command = "uv";
    commandArgs = [
      "run",
      "--refresh",
      "--python",
      typeof pin.python === "string" && pin.python ? pin.python : "3.12",
      ...withArgs.flatMap((spec) => ["--with", spec]),
      "python",
      ...base,
    ];
    label = `uv + lv24-seo ${engineVersion}`;
  } else if (commandExists("python")) {
    command = "python";
    commandArgs = base;
    label = "installed python + lv24-seo";
  } else {
    fail(
      "uv or python is required to regenerate contracts. Install uv (https://docs.astral.sh/uv/) " +
        "or run with --static to check only the committed files.",
    );
  }

  console.log(`contract check: regenerating with ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      UV_NO_PROGRESS: "1",
      LV24_SEO_ALLOW_FILE_SECRETS: "0",
    },
  });
  if (result.error) fail(`could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function assertEnvelope(path, fixtureName) {
  const envelope = readJson(path);
  if (typeof envelope !== "object" || envelope === null || Array.isArray(envelope)) {
    fail(`${relative(root, path)} is not a JSON object`);
  }
  if (typeof envelope.ok !== "boolean") fail(`${fixtureName}: missing boolean ok`);
  if (typeof envelope.meta !== "object" || envelope.meta === null) {
    fail(`${fixtureName}: missing meta object`);
  }
  if (!Array.isArray(envelope.warnings)) fail(`${fixtureName}: missing warnings array`);
  if (envelope.ok === true) {
    if (!("data" in envelope)) fail(`${fixtureName}: ok=true without data`);
  } else {
    if (typeof envelope.error !== "object" || envelope.error === null) {
      fail(`${fixtureName}: ok=false without error object`);
    }
    if (typeof envelope.error.code !== "string" || !envelope.error.code) {
      fail(`${fixtureName}: error.code must be a non-empty string`);
    }
  }

  const text = readFileSync(path, "utf8");
  const forbidden = [
    /\bya29\.[A-Za-z0-9._-]{10,}/,
    /\bghp_[A-Za-z0-9]{20,}/,
    /\bsk-[A-Za-z0-9]{16,}/,
    /\bAIza[0-9A-Za-z_-]{20,}/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(text)) fail(`${fixtureName}: looks like it contains a secret (${pattern})`);
  }
}

function staticChecks() {
  if (!existsSync(schemaPath)) fail("missing contracts/config.schema.json");
  const schema = readJson(schemaPath);
  if (typeof schema.$id !== "string" || !schema.$id.endsWith("/contracts/config.schema.json")) {
    fail("config.schema.json is missing the stable $id");
  }
  if (typeof schema.$comment !== "string" || !schema.$comment.includes(engineVersion)) {
    fail(`config.schema.json does not name the pinned engine ${engineVersion}`);
  }
  if (typeof schema.properties !== "object" || schema.properties === null) {
    fail("config.schema.json is missing properties");
  }

  if (!existsSync(manifestPath)) fail("missing contracts/cli-v1/manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest.version !== engineVersion) {
    fail(
      `manifest version ${JSON.stringify(manifest.version)} does not match pinned ${engineVersion}`,
    );
  }
  if (typeof manifest.fixtures !== "object" || manifest.fixtures === null) {
    fail("manifest is missing fixtures");
  }

  const fixtureNames = Object.keys(manifest.fixtures);
  if (fixtureNames.length === 0) fail("manifest has no fixtures");
  for (const name of fixtureNames) {
    const entry = manifest.fixtures[name];
    if (!entry || typeof entry !== "object") fail(`${name}: invalid manifest entry`);
    if (typeof entry.file !== "string" || /[\\/]/.test(entry.file)) {
      fail(`${name}: fixture file must be a basename`);
    }
    if (!Array.isArray(entry.command) || !entry.command.every((part) => typeof part === "string")) {
      fail(`${name}: command must be a string array`);
    }
    if (!Number.isInteger(entry.exitCode)) fail(`${name}: exitCode must be an integer`);
    const path = join(cliDir, entry.file);
    if (!existsSync(path)) fail(`${name}: missing ${relative(root, path)}`);
    assertEnvelope(path, name);
  }

  const expectedFiles = new Set(fixtureNames.map((name) => manifest.fixtures[name].file));
  for (const file of readdirSync(cliDir)) {
    if (file.endsWith(".json") && file !== "manifest.json" && !expectedFiles.has(file)) {
      fail(`unexpected fixture ${relative(root, join(cliDir, file))}`);
    }
  }

  if (!existsSync(join(contractsDir, "stats-v1.md"))) {
    fail("missing contracts/stats-v1.md (stats contract note)");
  }

  if (typeof pin.targets !== "object" || pin.targets === null) {
    fail("pin is missing targets");
  }
  for (const [target, entry] of Object.entries(pin.targets)) {
    if (!entry || typeof entry !== "object") fail(`${target}: invalid pin entry`);
    if (typeof entry.path !== "string" || !entry.path) fail(`${target}: missing path`);
    if (entry.sha256 !== null && !/^[a-f0-9]{64}$/.test(String(entry.sha256))) {
      fail(`${target}: sha256 must be null or 64 lowercase hex characters`);
    }
    if (entry.size !== null && (!Number.isInteger(entry.size) || entry.size <= 0)) {
      fail(`${target}: size must be null or a positive integer`);
    }
  }

  console.log(
    `contract check: static checks passed (${fixtureNames.length} fixtures, engine ${engineVersion})`,
  );
}

if (!staticOnly) {
  runGenerator(update ? "--write" : "--check");
}
staticChecks();
