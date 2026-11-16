import { afterAll, describe, expect, it } from "vitest";

import {
  cleanupTempDirs,
  fakeSignature,
  makeReleaseDist,
  mergeLatestJson,
  repoRoot,
} from "./release-fixtures.mjs";
import { DEFAULT_SCHEMA, loadJson, validateAgainstSchema, validateLatestFile } from "./validate-latest-json.mjs";

afterAll(cleanupTempDirs);

const signature = fakeSignature("manifest");

function validManifest() {
  const entry = (asset) => ({
    signature,
    url: `https://github.com/LevapVeeskela/lv24-seo-optimizer-desktop/releases/download/v0.2.2/${asset}`,
  });
  return {
    version: "0.2.2",
    notes: "Fixture notes",
    pub_date: "2026-11-15T00:00:00Z",
    platforms: {
      "windows-x86_64": entry("LV24.SEO.Optimizer_0.2.2_x64-setup.exe"),
      "linux-x86_64": entry("LV24.SEO.Optimizer_0.2.2_amd64.AppImage"),
      "darwin-aarch64": entry("LV24.SEO.Optimizer_0.2.2_aarch64.app.tar.gz"),
      "darwin-x86_64": entry("LV24.SEO.Optimizer_0.2.2_x64.app.tar.gz"),
    },
  };
}

function errorsFor(mutate) {
  const manifest = validManifest();
  mutate(manifest);
  return validateAgainstSchema(manifest, loadJson(DEFAULT_SCHEMA));
}

describe("contracts/latest.schema.json", () => {
  it("has a stable $id inside contracts/", () => {
    const schema = loadJson(DEFAULT_SCHEMA);
    expect(schema.$id.endsWith("/contracts/latest.schema.json")).toBe(true);
    expect(DEFAULT_SCHEMA.startsWith(repoRoot)).toBe(true);
  });

  it("accepts a complete four-platform manifest", () => {
    expect(validateAgainstSchema(validManifest(), loadJson(DEFAULT_SCHEMA))).toEqual([]);
  });

  it("requires the documented top-level fields", () => {
    expect(errorsFor((m) => delete m.notes).join("\n")).toContain('missing required property "notes"');
    expect(errorsFor((m) => delete m.pub_date).join("\n")).toContain('missing required property "pub_date"');
    expect(errorsFor((m) => (m.version = "0.2")).join("\n")).toContain("does not match");
  });

  it("requires every shipped generic platform", () => {
    const errors = errorsFor((m) => delete m.platforms["darwin-x86_64"]);
    expect(errors.join("\n")).toContain('missing required property "darwin-x86_64"');
  });

  it("rejects platform keys the updater plugin never probes", () => {
    const errors = errorsFor((m) => {
      m.platforms["Windows-X86_64"] = m.platforms["windows-x86_64"];
    });
    expect(errors.join("\n")).toContain('invalid property name "Windows-X86_64"');
  });

  it("rejects short or non-base64 signatures", () => {
    expect(errorsFor((m) => (m.platforms["linux-x86_64"].signature = "abc")).join("\n")).toContain(
      "below the minimum",
    );
    expect(
      errorsFor((m) => (m.platforms["linux-x86_64"].signature = `${"A".repeat(70)}!`)).join("\n"),
    ).toContain("does not match");
  });

  it("rejects a non-HTTPS or empty URL", () => {
    expect(
      errorsFor((m) => (m.platforms["linux-x86_64"].url = "http://example.com/a.AppImage")).join("\n"),
    ).toContain("does not match");
    expect(errorsFor((m) => (m.platforms["linux-x86_64"].url = "")).join("\n")).toContain(
      "does not match",
    );
  });

  it("rejects unknown fields that the plugin would ignore", () => {
    expect(errorsFor((m) => (m.sha256 = "a".repeat(64))).join("\n")).toContain(
      'unexpected property "sha256"',
    );
    expect(
      errorsFor((m) => (m.platforms["linux-x86_64"].size = 1)).join("\n"),
    ).toContain('unexpected property "size"');
  });

  it("validates the manifest produced by merge-latest-json.mjs", () => {
    const dist = makeReleaseDist();
    const merged = mergeLatestJson(dist.dir);

    expect(merged.status).toBe(0);
    const { errors, latest } = validateLatestFile(merged.manifestPath);
    expect(errors).toEqual([]);
    expect(Object.keys(latest.platforms)).toContain("windows-x86_64-nsis");
  });
});
