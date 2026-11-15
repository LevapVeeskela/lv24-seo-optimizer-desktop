import { describe, expect, it } from "vitest";
import {
  configsEqual,
  getConfigValue,
  setConfigValue,
} from "@/entities/config/lib/model";
import { defaultConfig } from "@/entities/config/model/types";

describe("setConfigValue", () => {
  it("never enables a provider block from a field edit", () => {
    const draft = setConfigValue(
      defaultConfig(),
      "providers.gsc.property",
      "sc-domain:example.com",
    );
    expect(draft.providers.gsc.property).toBe("sc-domain:example.com");
    expect(draft.providers.gsc.present).toBe(false);
  });

  it("toggles provider presence explicitly", () => {
    const enabled = setConfigValue(defaultConfig(), "providers.gsc.present", true);
    expect(enabled.providers.gsc.present).toBe(true);
    const disabled = setConfigValue(enabled, "providers.gsc.present", false);
    expect(disabled.providers.gsc.present).toBe(false);
  });

  it("does not mutate the source model", () => {
    const model = defaultConfig();
    setConfigValue(model, "project.name", "changed");
    expect(model.project.name).toBe("");
  });

  it("fails loudly on an unknown path", () => {
    expect(() => setConfigValue(defaultConfig(), "missing.name", 1)).toThrow(
      "unknown config path: missing.name",
    );
  });

  it("reads nested values back", () => {
    expect(getConfigValue(defaultConfig(), "crawl.max_urls")).toBe(500);
    expect(getConfigValue(defaultConfig(), "missing.path")).toBeUndefined();
  });
});

describe("configsEqual", () => {
  it("compares structural content, not identity", () => {
    const left = defaultConfig();
    const right = setConfigValue(left, "project.name", "changed");
    expect(configsEqual(left, defaultConfig())).toBe(true);
    expect(configsEqual(left, right)).toBe(false);
  });

  it("treats two nulls as equal and a null as unequal to a model", () => {
    expect(configsEqual(null, null)).toBe(true);
    expect(configsEqual(null, defaultConfig())).toBe(false);
  });
});
