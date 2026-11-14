import { describe, expect, it } from "vitest";
import { diffConfigs, diffToPatches, formatDiffValue } from "./diff";
import { setConfigValue } from "@/entities/config/lib/model";
import { defaultConfig, type ConfigDiffEntry } from "@/entities/config/model/types";

function entry(
  path: string,
  saved: unknown,
  draft: unknown,
  kind: ConfigDiffEntry["kind"] = "value",
): ConfigDiffEntry {
  return { path, saved, draft, reserved: false, kind };
}

describe("diffToPatches", () => {
  it("maps changed leaves to config_patch operations", () => {
    const patches = diffToPatches([
      entry("project.name", "old.example", "new.example"),
      entry("report.locale", "ru", "en"),
      entry("report.email.port", 465, 587),
    ]);

    expect(patches).toEqual([
      { path: "project.name", value: "new.example" },
      { path: "report.locale", value: "en" },
      { path: "report.email.port", value: 587 },
    ]);
  });

  it("removes a deleted leaf with null", () => {
    expect(diffToPatches([entry("project.default_property", "https://a", undefined)])).toEqual([
      { path: "project.default_property", value: null },
    ]);
  });

  it("keeps arrays as values", () => {
    expect(
      diffToPatches([entry("providers.psi.urls", ["https://a"], ["https://a", "https://b"])]),
    ).toEqual([
      { path: "providers.psi.urls", value: ["https://a", "https://b"] },
    ]);
  });

  it("removes a disabled provider block once and skips its leaves", () => {
    const patches = diffToPatches([
      entry("providers.gsc.present", true, false, "presence"),
      entry("providers.gsc.property", "https://a", undefined),
      entry("providers.bing.site", undefined, "https://b"),
    ]);

    expect(patches).toEqual([
      { path: "providers.gsc", value: null },
      { path: "providers.bing.site", value: "https://b" },
    ]);
  });

  it("never writes the UI-only present flag", () => {
    const patches = diffToPatches([
      entry("providers.gsc.present", false, true, "presence"),
      entry("providers.gsc.property", undefined, "https://a"),
    ]);

    expect(patches).toEqual([{ path: "providers.gsc.property", value: "https://a" }]);
    expect(patches.some((patch) => patch.path.endsWith(".present"))).toBe(false);
  });
});

describe("diffConfigs", () => {
  it("returns no entries for identical models", () => {
    expect(diffConfigs(defaultConfig(), defaultConfig())).toEqual([]);
  });

  it("reports a field-level value change", () => {
    const saved = defaultConfig();
    const draft = setConfigValue(saved, "project.name", "example.com");
    const diff = diffConfigs(saved, draft);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({
      path: "project.name",
      saved: "",
      draft: "example.com",
      kind: "value",
      reserved: false,
    });
  });

  it("marks reserved fields", () => {
    const saved = defaultConfig();
    const draft = setConfigValue(saved, "crawl.concurrency", 8);
    expect(diffConfigs(saved, draft)[0]).toMatchObject({
      path: "crawl.concurrency",
      reserved: true,
    });
  });

  it("makes adding a provider block visible", () => {
    const saved = defaultConfig();
    const draft = setConfigValue(saved, "providers.gsc.property", "sc-domain:example.com");
    expect(diffConfigs(saved, draft)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "providers.gsc.present",
          kind: "presence",
          saved: false,
          draft: true,
        }),
        expect.objectContaining({
          path: "providers.gsc.property",
          draft: "sc-domain:example.com",
        }),
      ]),
    );
  });

  it("formats values for the diff table", () => {
    expect(formatDiffValue(undefined)).toBe("—");
    expect(formatDiffValue("")).toBe("—");
    expect(formatDiffValue(true)).toBe("true");
    expect(formatDiffValue([])).toBe("[]");
    expect(formatDiffValue(["a", "b"])).toBe("a, b");
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
  });
});
