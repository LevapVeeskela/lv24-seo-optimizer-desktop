import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupTempDirs,
  makeReleaseDist,
  mergeLatestJson,
  REPO,
} from "./release-fixtures.mjs";
import { validateLatestFile } from "./validate-latest-json.mjs";

afterAll(cleanupTempDirs);

const GENERIC = ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"];
const ALIASES = [
  "darwin-aarch64-app",
  "darwin-x86_64-app",
  "linux-x86_64-appimage",
  "windows-x86_64-nsis",
];

describe("merge-latest-json", () => {
  it("writes every generic platform, bundle alias and deb/rpm entry", () => {
    const dist = makeReleaseDist();
    const result = mergeLatestJson(dist.dir);

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.manifest.version).toBe("0.2.2");
    expect(result.manifest.notes).toBe("Fixture notes");
    expect(result.manifest.pub_date).toBe("2026-11-15T00:00:00Z");

    const platforms = Object.keys(result.manifest.platforms).sort();
    expect(platforms).toEqual(
      [...GENERIC, ...ALIASES, "linux-x86_64-deb", "linux-x86_64-rpm"].sort(),
    );

    const prefix = `https://github.com/${REPO}/releases/download/v0.2.2/`;
    for (const [platform, entry] of Object.entries(result.manifest.platforms)) {
      expect(entry.url.startsWith(prefix), platform).toBe(true);
      expect(entry.signature.length, platform).toBeGreaterThanOrEqual(64);
    }
    expect(result.manifest.platforms["windows-x86_64"].url.endsWith("_x64-setup.exe")).toBe(true);
    expect(result.manifest.platforms["windows-x86_64-nsis"].url).toBe(
      result.manifest.platforms["windows-x86_64"].url,
    );
    expect(result.manifest.platforms["linux-x86_64"].url.endsWith(".AppImage")).toBe(true);
    expect(result.manifest.platforms["linux-x86_64-deb"].url.endsWith(".deb")).toBe(true);
  });

  it("accepts the v1Compatible .nsis.zip and .AppImage.tar.gz variants", () => {
    const dist = makeReleaseDist({ windows: "nsis", linux: "archive" });
    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(0);
    expect(result.manifest.platforms["windows-x86_64"].url.endsWith(".nsis.zip")).toBe(true);
    expect(result.manifest.platforms["linux-x86_64"].url.endsWith(".AppImage.tar.gz")).toBe(true);
    expect(result.manifest.platforms["linux-x86_64-appimage"].url).toBe(
      result.manifest.platforms["linux-x86_64"].url,
    );
  });

  it("omits deb/rpm aliases when Tauri did not sign those bundles", () => {
    const dist = makeReleaseDist({ debSignature: false, rpmSignature: false });
    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(0);
    expect(result.manifest.platforms["linux-x86_64-deb"]).toBeUndefined();
    expect(result.manifest.platforms["linux-x86_64-rpm"]).toBeUndefined();
    expect(result.stderr).toContain("no deb signature/metadata");
  });

  it("fails when a generic platform has no updater metadata", () => {
    const dist = makeReleaseDist();
    dist.remove("updater-darwin-x86_64.json");

    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing updater metadata for darwin-x86_64");
    expect(result.manifest).toBeNull();
  });

  it("fails when the metadata signature does not match the .sig file", () => {
    const dist = makeReleaseDist();
    const asset = dist.files.find((name) => name.endsWith(".AppImage"));
    dist.overwrite(`${asset}.sig`, `${"B".repeat(88)}\n`);

    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`signature does not match ${asset}.sig`);
  });

  it("fails when the tag and version disagree", () => {
    const dist = makeReleaseDist();

    const wrongTag = mergeLatestJson(dist.dir, { tag: "v0.2.3" });
    expect(wrongTag.status).toBe(1);
    expect(wrongTag.stderr).toContain('version "0.2.2" != 0.2.3');

    const wrongVersion = mergeLatestJson(dist.dir, { version: "0.2.3" });
    expect(wrongVersion.status).toBe(1);
    expect(wrongVersion.stderr).toContain("does not match tag");
  });

  it("fails when a metadata asset is missing from dist", () => {
    const dist = makeReleaseDist();
    dist.remove(dist.files.find((name) => name.endsWith(".deb")));

    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is not present in");
  });

  it("fails when deb metadata exists without its signature file", () => {
    const dist = makeReleaseDist();
    dist.remove(dist.files.find((name) => name.endsWith(".deb.sig")));

    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("signature file is missing");
  });

  it("fails on an unknown platform key", () => {
    const dist = makeReleaseDist();
    dist.overwrite(
      "updater-darwin-x86_64-app.json",
      JSON.stringify({
        platform: "solaris-sparc",
        asset: "x.app.tar.gz",
        signature: "A".repeat(88),
        version: "0.2.2",
      }),
    );

    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown platform");
  });

  it("produces a manifest that validates against contracts/latest.schema.json", () => {
    const dist = makeReleaseDist();
    const result = mergeLatestJson(dist.dir);

    expect(result.status).toBe(0);
    const validation = validateLatestFile(result.manifestPath);
    expect(validation.errors).toEqual([]);
  });
});
