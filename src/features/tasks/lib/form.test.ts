import { describe, expect, it } from "vitest";
import { EMPTY_ADD_TASK_FORM, validateAddTaskForm } from "./form";

function values(overrides: Partial<typeof EMPTY_ADD_TASK_FORM> = {}) {
  return {
    ...EMPTY_ADD_TASK_FORM,
    kind: "decay",
    url: "https://example.com/a",
    rule: "decay-stale",
    ...overrides,
  };
}

describe("add task form validation", () => {
  it("accepts the minimal task and trims every string", () => {
    const result = validateAddTaskForm(
      values({
        kind: "  decay ",
        url: " https://example.com/a ",
        rule: " decay-stale ",
        property: " sc-domain:example.com ",
      }),
    );
    expect(result).toEqual({
      ok: true,
      input: {
        kind: "decay",
        url: "https://example.com/a",
        rule: "decay-stale",
        property: "sc-domain:example.com",
      },
    });
  });

  it("requires kind, url and rule", () => {
    const result = validateAddTaskForm(
      values({ kind: " ", url: "", rule: "  " }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.kind?.code).toBe("required");
      expect(result.errors.url?.code).toBe("required");
      expect(result.errors.rule?.code).toBe("required");
    }
  });

  it("accepts an optional JSON object payload", () => {
    const result = validateAddTaskForm(
      values({ payload: '{"months_stale":16,"nested":{"ok":true}}' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.input.payload).toEqual({
        months_stale: 16,
        nested: { ok: true },
      });
    }
  });

  it("rejects invalid JSON, non-objects and credential-shaped keys", () => {
    const invalid = validateAddTaskForm(values({ payload: "{oops" }));
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.errors.payload?.code).toBe("invalidJson");
    }

    const array = validateAddTaskForm(values({ payload: "[1,2]" }));
    expect(array.ok).toBe(false);
    if (!array.ok) {
      expect(array.errors.payload?.code).toBe("notObject");
    }

    const secret = validateAddTaskForm(
      values({ payload: '{"nested":{"gsc_token":"secret"}}' }),
    );
    expect(secret.ok).toBe(false);
    if (!secret.ok && secret.errors.payload?.code === "secretKey") {
      expect(secret.errors.payload.path).toBe("payload.nested.gsc_token");
    } else {
      throw new Error("expected a secretKey error");
    }
  });

  it("leaves an empty payload out of the command arguments", () => {
    const result = validateAddTaskForm(values({ payload: "  " }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("payload" in result.input).toBe(false);
      expect("property" in result.input).toBe(false);
    }
  });
});
