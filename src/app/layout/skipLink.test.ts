import { describe, expect, it, vi } from "vitest";
import { activateSkipLink } from "./skipLink";

describe("activateSkipLink", () => {
  it("prevents the hash navigation and focuses the main region", () => {
    const event = { preventDefault: vi.fn() };
    const target = { focus: vi.fn() };

    activateSkipLink(event, target);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(target.focus).toHaveBeenCalledTimes(1);
  });

  it("still prevents navigation when the main region is not mounted yet", () => {
    const event = { preventDefault: vi.fn() };

    activateSkipLink(event, null);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });
});
