import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { ScheduleStore } from "../model/ScheduleStore";
import { ScheduleInstallPanel } from "./ScheduleInstallPanel";

const CONFIG = "C:\\ws\\seo.toml";

function render(store: ScheduleStore): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <ScheduleInstallPanel store={store} configPath={CONFIG} blocked={false} />
    </I18nProvider>,
  );
}

describe("ScheduleInstallPanel", () => {
  it("shows the install form with the engine default cron", () => {
    const html = render(new ScheduleStore());
    expect(html).toContain("Install a scheduled report");
    expect(html).toContain("Install schedule");
    expect(html).toContain("Engine default");
    expect(html).toContain("Nothing installed yet");
    expect(html).toContain("Weekly");
    expect(html).toContain("Daily");
  });

  it("renders the explicit confirmation copy", () => {
    const html = render(new ScheduleStore());
    expect(html).toContain("Install this schedule?");
    expect(html).toContain(
      "This writes a weekly job to this computer&#x27;s scheduler for C:\\ws\\seo.toml.",
    );
    expect(html).toContain("The engine uses its default time");
    expect(html).toContain("Nothing is written until you press Install");
    expect(html).toContain("--allow-write");
  });

  it("shows the installed files and warnings", () => {
    const store = new ScheduleStore();
    store.installState = "installed";
    store.installResult = {
      target: "windows",
      dryRun: false,
      installed: true,
      command: "schtasks /Create /XML C:\\tasks\\lv24-seo-weekly.xml",
      files: [],
      warnings: [],
      paths: [
        {
          name: "lv24-seo-weekly.xml",
          content: "C:\\tasks\\lv24-seo-weekly.xml",
        },
      ],
    };
    store.installWarnings = ["the task runs as the signed-in user"];
    const html = render(store);
    expect(html).toContain("Install result");
    expect(html).toContain("Installed");
    expect(html).toContain("Installed files");
    expect(html).toContain("lv24-seo-weekly.xml");
    expect(html).toContain("the task runs as the signed-in user");
  });

  it("shows a failed install with the engine code", () => {
    const store = new ScheduleStore();
    store.installState = "error";
    store.installError = {
      code: "INVALID_INPUT",
      message: "cron is not supported by the Windows scheduler",
      retryable: false,
    };
    const html = render(store);
    expect(html).toContain("Schedule install failed");
    expect(html).toContain("cron is not supported");
    expect(html).toContain("INVALID_INPUT");
  });

  it("shows the inline cron error without an install result", () => {
    const store = new ScheduleStore();
    store.setInstallCron("0 7 * *");
    const html = render(store);
    expect(html).toContain("A cron expression needs five fields");
    expect(html).toContain("Nothing installed yet");
  });
});
