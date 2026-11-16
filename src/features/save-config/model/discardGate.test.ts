import { describe, expect, it, vi } from "vitest";
import { confirmDiscardBeforeAction } from "./discardGate";

describe("confirmDiscardBeforeAction", () => {
  it("does not prompt for a clean draft", async () => {
    const confirm = vi.fn(async () => false);
    await expect(confirmDiscardBeforeAction(false, confirm)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("prompts while the draft is dirty and honours the answer", async () => {
    const cancel = vi.fn(async () => false);
    const discard = vi.fn(async () => true);

    await expect(confirmDiscardBeforeAction(true, cancel)).resolves.toBe(false);
    await expect(confirmDiscardBeforeAction(true, discard)).resolves.toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
  });
});
