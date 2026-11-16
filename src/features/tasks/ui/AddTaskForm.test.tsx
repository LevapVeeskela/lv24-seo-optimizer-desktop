import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { AddTaskForm } from "./AddTaskForm";

function render(disabled = false) {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <AddTaskForm
        disabled={disabled}
        defaultProperty="sc-domain:example.com"
        onSubmit={async () => ({
          ok: true,
          task: null,
          outcome: "created",
        })}
      />
    </I18nProvider>,
  );
}

describe("AddTaskForm", () => {
  it("renders every required field and the evidence hint", () => {
    const html = render();
    expect(html).toContain("Add a task");
    expect(html).toContain('for="task-add-kind"');
    expect(html).toContain('for="task-add-url"');
    expect(html).toContain('for="task-add-rule"');
    expect(html).toContain('for="task-add-property"');
    expect(html).toContain('for="task-add-payload"');
    expect(html).toContain("Secret-looking keys are rejected.");
    expect(html).toContain('value="sc-domain:example.com"');
    expect(html).toContain("Add task");
  });

  it("disables the form while the page is blocked", () => {
    const html = render(true);
    expect(html).toContain('disabled=""');
  });
});
