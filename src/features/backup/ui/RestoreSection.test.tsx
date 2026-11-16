import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "@/shared/i18n";
import { BackupStore } from "../model/BackupStore";
import { normalizeRestorePlan } from "../model/restore";
import { RestoreSection } from "./RestoreSection";

const CONFIG = "C:\\ws\\seo.toml";
const ARCHIVE = "C:\\backups\\lv24-seo-backup.zip";

function render(store: BackupStore): string {
  return renderToStaticMarkup(
    <I18nProvider locale="en" onLocaleChange={() => {}}>
      <RestoreSection store={store} configPath={CONFIG} blocked={false} />
    </I18nProvider>,
  );
}

function planned(token: string | null): BackupStore {
  const store = new BackupStore();
  store.setRestoreFile(ARCHIVE);
  store.restorePlan = {
    ...normalizeRestorePlan({
      status: "dry_run",
      plan: {
        action: "backup_restore",
        target: CONFIG,
        summary: "restore 2 files into C:\\ws",
        payload: { archive: ARCHIVE, database: true },
      },
      plan_hash: "sha256:plan",
      ttl_seconds: 300,
    }),
    confirmToken: token,
  };
  store.restoreState = "planned";
  return store;
}

describe("RestoreSection", () => {
  it("starts with an archive picker and no planned restore", () => {
    const html = render(new BackupStore());
    expect(html).toContain("Restore from archive");
    expect(html).toContain("Choose archive");
    expect(html).toContain("No archive selected");
    expect(html).toContain("Review restore");
    expect(html).toContain("Restore now");
    expect(html).toContain("No restore planned");
  });

  it("renders the reviewed plan, token lifetime and details", () => {
    const html = render(planned("1700000000:abcdef"));
    expect(html).toContain("Restore plan");
    expect(html).toContain("restore 2 files into C:\\ws");
    expect(html).toContain("Plan hash");
    expect(html).toContain("sha256:plan");
    expect(html).toContain("The confirmation token is valid for 300 seconds.");
    expect(html).toContain("Plan details");
    expect(html).not.toContain("The engine returned a plan without");
  });

  it("disables apply when the plan has no token", () => {
    const html = render(planned(null));
    expect(html).toContain(
      "The engine returned a plan without a confirmation token",
    );
  });

  it("shows the applied result and its details", () => {
    const store = planned("1700000000:abcdef");
    store.restoreState = "restored";
    store.restoreOutcome = {
      status: "applied",
      reason: null,
      plan: store.restorePlan!,
      details: [{ key: "restored", value: "2" }],
    };
    const html = render(store);
    expect(html).toContain("Restore result");
    expect(html).toContain("Applied");
    expect(html).toContain("Result details");
    expect(html).toContain("restored");
  });

  it("keeps the error and the retry action visible", () => {
    const store = new BackupStore();
    store.setRestoreFile(ARCHIVE);
    store.restoreError = {
      code: "CONFIRM_REQUIRED",
      message: "confirm token is missing, expired or does not match",
      retryable: false,
    };
    store.restoreState = "error";
    const html = render(store);
    expect(html).toContain("Restore failed");
    expect(html).toContain("confirm token is missing");
    expect(html).toContain("CONFIRM_REQUIRED");
    expect(html).toContain("Retry");
  });

  it("always renders the explicit confirmation dialog copy", () => {
    const html = render(planned("1700000000:abcdef"));
    expect(html).toContain("Restore this backup?");
    expect(html).toContain(
      "The current data is not backed up automatically",
    );
  });
});
