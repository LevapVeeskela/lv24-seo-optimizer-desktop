import { describe, expect, it } from "vitest";
import { activePeriod } from "../index";

describe("activePeriod", () => {
  it("ends at today minus the provider lag", () => {
    expect(activePeriod(7, 2, new Date(2026, 10, 16))).toEqual({
      start: "2026-11-08",
      end: "2026-11-14",
    });
    expect(activePeriod(28, 3, new Date(2026, 10, 16))).toEqual({
      start: "2026-10-17",
      end: "2026-11-13",
    });
  });

  it("crosses month and year boundaries", () => {
    expect(activePeriod(90, 2, new Date(2026, 0, 1))).toEqual({
      start: "2025-10-02",
      end: "2025-12-30",
    });
  });
});
