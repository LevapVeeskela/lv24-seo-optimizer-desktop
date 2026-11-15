#!/usr/bin/env node
/**
 * Published release asset allowlist and `SHA256SUMS.txt` generator.
 *
 * This module is the single source of truth for:
 *   - which files in `dist/` may be published to the GitHub release;
 *   - which files `SHA256SUMS.txt` covers;
 *   - which files the upload step sends.
 *
 * The allowlist used to be duplicated as an inline heredoc (checksums) and a
 * bash `case` (upload). QA-08 caught the drift: `*-portable.zip.sha256` was
 * produced by `scripts/package-portable.mjs` and shipped inside the CI
 * artifact, but silently dropped from the release. One module plus tests keeps
 * the three consumers in sync.
 *
 * Usage:
 *   node scripts/release-assets.mjs --dist dist            # check and list
 *   node scripts/release-assets.mjs --dist dist --write    # write SHA256SUMS.txt
 *   node scripts/release-assets.mjs --dist dist --list0    # NUL-separated paths
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Publishable basenames. `SHA256SUMS.txt` is deliberately absent: it is
 * generated from this list and must never hash itself.
 */
export const PUBLISHED_PATTERNS = [
  /^latest\.json$/,
  /-setup\.exe(\.sig)?$/,
  /\.nsis\.zip(\.sig)?$/,
  /-portable\.zip(\.sha256)?$/,
  /\.dmg$/,
  /\.app\.tar\.gz(\.sig)?$/,
  /\.AppImage(\.tar\.gz)?(\.sig)?$/,
  /\.deb(\.sig)?$/,
  /\.rpm(\.sig)?$/,
];

export const SUMS_FILE = "SHA256SUMS.txt";

export function isPublishedAsset(name) {
  if (name === SUMS_FILE) return false;
  return PUBLISHED_PATTERNS.some((pattern) => pattern.test(name));
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Allowlisted basenames in `dist/`, sorted for deterministic output. */
export function listPublishedFiles(dist) {
  return readdirSync(dist)
    .filter((name) => statSync(join(dist, name)).isFile())
    .filter(isPublishedAsset)
    .sort();
}

/**
 * Files the upload step must send: every published asset plus the checksum
 * file itself when it has already been generated.
 */
export function listUploadFiles(dist) {
  const files = listPublishedFiles(dist);
  if (existsSync(join(dist, SUMS_FILE))) files.push(SUMS_FILE);
  return files.sort();
}

export function buildSha256Sums(dist) {
  const files = listPublishedFiles(dist);
  const lines = files.map((name) => `${sha256File(join(dist, name))}  ${name}`);
  return { files, lines, text: `${lines.join("\n")}\n` };
}

/** Asset basenames referenced by a parsed `latest.json`. */
export function assetNamesFromLatest(latest) {
  const platforms = latest?.platforms;
  if (typeof platforms !== "object" || platforms === null) return [];
  const names = [];
  for (const entry of Object.values(platforms)) {
    const url = entry?.url;
    if (typeof url !== "string" || url === "") continue;
    names.push(basename(url.split("?")[0]));
  }
  return names;
}

/**
 * Every reason the current `dist/` must not be published. An empty array means
 * the allowlist, `latest.json` references and checksum inputs agree.
 */
export function collectProblems(dist) {
  const problems = [];
  if (!existsSync(dist)) return [`dist directory not found: ${dist}`];

  const files = listPublishedFiles(dist);
  if (files.length === 0) {
    problems.push("no publishable release assets found in dist");
  }
  for (const name of files) {
    if (/\s/.test(name)) problems.push(`asset name contains whitespace: ${name}`);
  }
  if (new Set(files).size !== files.length) {
    problems.push("duplicate asset basenames in dist");
  }

  const latestPath = join(dist, "latest.json");
  if (!existsSync(latestPath)) {
    problems.push("latest.json is missing from dist");
    return problems;
  }
  let latest;
  try {
    latest = JSON.parse(readFileSync(latestPath, "utf8"));
  } catch (error) {
    problems.push(`latest.json is not valid JSON (${error.message})`);
    return problems;
  }
  for (const asset of assetNamesFromLatest(latest)) {
    if (!files.includes(asset)) {
      problems.push(`latest.json references ${asset}, which is not in ${SUMS_FILE}`);
    }
  }
  return problems;
}

function fail(problems) {
  for (const problem of problems) console.error(`::error::${problem}`);
  console.error(`release-assets: refusing to continue with ${problems.length} problem(s)`);
  process.exit(1);
}

function main(argv) {
  const args = argv.slice(2);
  const has = (flag) => args.includes(flag);
  const valueAfter = (flag, fallback) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : fallback;
  };

  const dist = resolve(root, valueAfter("--dist", "dist"));
  const problems = collectProblems(dist);
  if (problems.length > 0) fail(problems);

  if (has("--list0")) {
    // NUL-separated absolute paths so the workflow can build a bash array
    // without re-implementing the allowlist.
    process.stdout.write(listUploadFiles(dist).map((name) => join(dist, name)).join("\0") + "\0");
    return;
  }

  const sums = buildSha256Sums(dist);
  if (has("--write")) {
    writeFileSync(join(dist, SUMS_FILE), sums.text, "utf8");
    console.log(sums.text.trimEnd());
    console.log(`release-assets: wrote ${SUMS_FILE} with ${sums.files.length} entr${sums.files.length === 1 ? "y" : "ies"}`);
    return;
  }

  console.log(`release-assets: ${sums.files.length} publishable file(s) in ${dist}`);
  for (const name of sums.files) console.log(`  ${name}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
