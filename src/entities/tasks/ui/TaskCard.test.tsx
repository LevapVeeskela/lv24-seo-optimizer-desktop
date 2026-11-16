import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import type { TaskRow } from "../model/types";
import { TaskCard } from "./TaskCard";

const TASK: TaskRow = {
  id: 7,
  kind: "decay",
  propertyId: "sc-domain:example.com",
  url: "https://user:pass@example.com/a",
  ruleId: "decay-stale",
  state: "verified",
  payload: { months_stale: 16, gsc_token: "secret-value" },
  createdAt: "2026-11-01T10:00:00+00:00",
  updatedAt: "2026-11-02T10:00:00+00:00",
};

function render(task: TaskRow = TASK) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <TaskCard
        task={task}
        updating={false}
        onUpdate={() => {}}
      />
    </I18nProvider>,
  );
}

describe("TaskCard", () => {
  it("renders the state badge, redacted evidence and only legal transitions", () => {
    const html = render();
    expect(html).toContain("Verified");
    expect(html).toContain("decay-stale");
    expect(html).toContain("[redacted]");
    expect(html).not.toContain("secret-value");
    expect(html).not.toContain("user:pass@");
    expect(html).toContain("Open");
    expect(html).toContain("Dismissed");
    expect(html).not.toContain("In progress");
  });

  it("shows an honest empty evidence state", () => {
    const html = render({ ...TASK, payload: {} });
    expect(html).toContain("No evidence stored for this task.");
  });
});
