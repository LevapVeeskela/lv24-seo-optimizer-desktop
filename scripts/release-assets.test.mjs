import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildSha256Sums,
  collectProblems,
  isPublishedAsset,
  listPublishedFiles,
  listUploadFiles,
  SUMS_FILE,
} from "./release-assets.mjs";
import {
  cleanupTempDirs,
  makeReleaseDist,
  mergeLatestJson,
  runScript,
  tempDir,
} from "./release-fixtures.mjs";

afterAll(cleanupTempDirs);

const PORTABLE_ZIP = "LV24-SEO-Optimizer_0.2.2_x64-portable.zip";
const PORTABLE_SUM = `${PORTABLE_ZIP}.sha256`;

function mergedDist() {
  const dist = makeReleaseDist();
  dist.put(PORTABLE_ZIP);
  dist.put(PORTABLE_SUM, `${"c".repeat(64)}  ${PORTABLE_ZIP}\n`);
  const merged = mergeLatestJson(dist.dir);
  expect(merged.status).toBe(0);
  return dist;
}

describe("release-assets allowlist", () => {
  it("publishes the portable ZIP and its checksum sidecar (QA-08 regression)", () => {
    expect(isPublishedAsset(PORTABLE_ZIP)).toBe(true);
    expect(isPublishedAsset(PORTABLE_SUM)).toBe(true);
    expect(isPublishedAsset("LV24.SEO.Optimizer_0.2.2_x64-setup.exe")).toBe(true);
    expect(isPublishedAsset("LV24.SEO.Optimizer_0.2.2_x64-setup.exe.sig")).toBe(true);
    expect(isPublishedAsset("LV24.SEO.Optimizer_0.2.2_aarch64.app.tar.gz.sig")).toBe(true);
    expect(isPublishedAsset("LV24.SEO.Optimizer_0.2.2_amd64.deb.sig")).toBe(true);
    expect(isPublishedAsset("latest.json")).toBe(true);
  });

  it("never publishes CI evidence or the checksum file itself", () => {
    for (const name of [
      SUMS_FILE,
      "updater-windows-x86_64.json",
      "build-info-x86_64-pc-windows-msvc.json",
      "sidecar-checksums-x86_64-pc-windows-msvc.json",
      "release-notes.md",
    ]) {
      expect(isPublishedAsset(name), name).toBe(false);
    }
  });

  it("lists portable assets in a deterministic sorted order", () => {
    const dist = mergedDist();
    const files = listPublishedFiles(dist.dir);
    expect(files).toContain(PORTABLE_ZIP);
    expect(files).toContain(PORTABLE_SUM);
    expect(files).toEqual([...files].sort());
    expect(listUploadFiles(dist.dir)).not.toContain(SUMS_FILE);
  });
});

describe("release-assets SHA256SUMS", () => {
  it("hashes exactly the allowlisted files with sorted, fixed-width lines", () => {
    const dist = mergedDist();
    const sums = buildSha256Sums(dist.dir);

    expect(sums.files).toEqual(listPublishedFiles(dist.dir));
    expect(sums.text.endsWith("\n")).toBe(true);
    expect(sums.text.trimEnd().split("\n")).toHaveLength(sums.files.length);
    for (const line of sums.text.trimEnd().split("\n")) {
      expect(line).toMatch(/^[a-f0-9]{64} {2}[^ ]+$/);
    }

    const expected = createHash("sha256")
      .update(readFileSync(join(dist.dir, "latest.json")))
      .digest("hex");
    expect(sums.text).toContain(`${expected}  latest.json`);
  });

  it("writes SHA256SUMS.txt with --write and includes it in the upload list", () => {
    const dist = mergedDist();
    const result = runScript("release-assets.mjs", ["--dist", dist.dir, "--write"]);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(existsSync(join(dist.dir, SUMS_FILE))).toBe(true);
    expect(readFileSync(join(dist.dir, SUMS_FILE), "utf8")).toBe(buildSha256Sums(dist.dir).text);
    expect(listUploadFiles(dist.dir)).toContain(SUMS_FILE);
  });

  it("emits NUL-separated absolute paths for the upload step with --list0", () => {
    const dist = mergedDist();
    runScript("release-assets.mjs", ["--dist", dist.dir, "--write"]);

    const result = runScript("release-assets.mjs", ["--dist", dist.dir, "--list0"]);
    const entries = result.stdout.split("\0").filter(Boolean);

    expect(result.status).toBe(0);
    expect(entries).toContain(join(dist.dir, "latest.json"));
    expect(entries).toContain(join(dist.dir, PORTABLE_SUM));
    expect(entries).toContain(join(dist.dir, SUMS_FILE));
    expect(entries.some((entry) => entry.includes("updater-"))).toBe(false);
  });

  it("does not write the checksum file without --write", () => {
    const dist = mergedDist();
    const result = runScript("release-assets.mjs", ["--dist", dist.dir]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("publishable file(s)");
    expect(existsSync(join(dist.dir, SUMS_FILE))).toBe(false);
  });
});

describe("release-assets gates", () => {
  it("fails when latest.json references an asset outside the allowlist", () => {
    const dist = mergedDist();
    const latestPath = join(dist.dir, "latest.json");
    const latest = JSON.parse(readFileSync(latestPath, "utf8"));
    latest.platforms["darwin-aarch64"].url = latest.platforms["darwin-aarch64"].url.replace(
      /[^/]+$/,
      "missing.dmg",
    );
    dist.overwrite("latest.json", JSON.stringify(latest));

    const result = runScript("release-assets.mjs", ["--dist", dist.dir, "--write"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing.dmg");
    expect(existsSync(join(dist.dir, SUMS_FILE))).toBe(false);
  });

  it("fails on an asset name that contains whitespace", () => {
    const dist = mergedDist();
    dist.put("bad name.dmg");

    expect(collectProblems(dist.dir).join("\n")).toContain("contains whitespace");
    expect(runScript("release-assets.mjs", ["--dist", dist.dir]).status).toBe(1);
  });

  it("fails when latest.json is missing", () => {
    const dist = mergedDist();
    dist.remove("latest.json");

    const result = runScript("release-assets.mjs", ["--dist", dist.dir]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("latest.json is missing");
  });

  it("fails when nothing publishable is staged", () => {
    const empty = tempDir("empty");

    const result = runScript("release-assets.mjs", ["--dist", empty]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no publishable release assets");
  });

  it("fails when the dist directory does not exist", () => {
    const missing = join(tempDir("gone"), "dist");

    const result = runScript("release-assets.mjs", ["--dist", missing]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("dist directory not found");
  });
});
