import { describe, expect, it } from "vitest";
import { isObservableProp } from "mobx";
import { ConfigStore } from "@/entities/config";
import { RootStore } from "./RootStore";

describe("RootStore", () => {
  it("owns one shared ConfigStore for Settings and Config", () => {
    const root = new RootStore();
    expect(root.config).toBeInstanceOf(ConfigStore);
    expect(root.config).toBe(root.config);
    // Stores are wired once and never deep-observed by the root store.
    expect(isObservableProp(root, "config")).toBe(false);
  });
});
