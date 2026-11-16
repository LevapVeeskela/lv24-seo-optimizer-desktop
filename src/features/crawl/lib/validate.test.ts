import { describe, expect, it } from "vitest";
import { isValidMaxUrls, isValidStartUrl } from "./validate";

describe("isValidStartUrl", () => {
  it("accepts blank, http and https absolute URLs", () => {
    expect(isValidStartUrl("")).toBe(true);
    expect(isValidStartUrl("   ")).toBe(true);
    expect(isValidStartUrl("https://example.com/path")).toBe(true);
    expect(isValidStartUrl("http://localhost:8080")).toBe(true);
  });

  it("rejects relative, non-http and malformed values", () => {
    expect(isValidStartUrl("/path")).toBe(false);
    expect(isValidStartUrl("example.com")).toBe(false);
    expect(isValidStartUrl("ftp://example.com")).toBe(false);
    expect(isValidStartUrl("javascript:alert(1)")).toBe(false);
    expect(isValidStartUrl("https://")).toBe(false);
  });
});

describe("isValidMaxUrls", () => {
  it("accepts blank and the engine range 1..10000", () => {
    expect(isValidMaxUrls("")).toBe(true);
    expect(isValidMaxUrls("1")).toBe(true);
    expect(isValidMaxUrls("10000")).toBe(true);
  });

  it("rejects zero, over-budget and non-integer values", () => {
    expect(isValidMaxUrls("0")).toBe(false);
    expect(isValidMaxUrls("10001")).toBe(false);
    expect(isValidMaxUrls("-5")).toBe(false);
    expect(isValidMaxUrls("1.5")).toBe(false);
    expect(isValidMaxUrls("abc")).toBe(false);
  });
});
