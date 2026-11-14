import { observer } from "mobx-react-lite";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useRootStore } from "@/app/providers/StoreProvider";
import { useI18n, type MessageKey } from "@/shared/i18n";
import { formatDateTime } from "@/shared/lib/format";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Card } from "@/shared/ui/Card";
import { Notice } from "@/shared/ui/Notice";
import { useFeedback } from "@/shared/ui/Feedback";
import { UPDATE_RELEASE_URL, type UpdateState } from "@/entities/update";

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const STATE_KEYS: Record<UpdateState, MessageKey> = {
  idle: "update.state.idle",
  checking: "update.state.checking",
  available: "update.state.available",
  downloading: "update.state.downloading",
  ready: "update.state.ready",
  error: "update.state.error",
  unsupported: "update.state.unsupported",
};

const STATE_TONES: Record<UpdateState, Tone> = {
  idle: "neutral",
  checking: "neutral",
  available: "info",
  downloading: "neutral",
  ready: "info",
  error: "danger",
  unsupported: "warning",
};

function noteLines(notes: string | null): string[] {
  return notes
    ? notes
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
}

export const UpdatePanel = observer(function UpdatePanel() {
  const { t, locale } = useI18n();
  const { config, update } = useRootStore();
  const { notify } = useFeedback();
  const available = update.available;
  const notes = noteLines(available?.notes ?? null);
  const percent = update.percent;
  const portable = update.isPortable;
  const manualBundle = !portable && !update.canAutoUpdate;
  const isSecurity = update.error?.code === "UPDATE_SECURITY";
  const isOffline = update.error?.code === "UPDATE_OFFLINE";
  const stateKey = portable
    ? "update.state.portable"
    : manualBundle
      ? "update.state.manual"
      : update.state === "idle" && update.lastCheckFailed
        ? "update.state.offline"
        : update.state === "idle" && update.lastChecked
          ? "update.state.upToDate"
          : STATE_KEYS[update.state];
  const tone: Tone = portable
    ? "neutral"
    : manualBundle
      ? "warning"
      : update.state === "idle" && update.lastCheckFailed
        ? "warning"
        : update.state === "idle" && update.lastChecked
          ? "success"
          : STATE_TONES[update.state];
  const lastChecked = update.lastChecked
    ? t("update.lastChecked", {
        value: formatDateTime(update.lastChecked, locale),
      })
    : t("update.neverChecked");

  const runCheck = async () => {
    const found = await update.check({ silent: false });
    if (found && update.available) {
      notify(
        t("update.checkFound", { version: update.available.version }),
        "success",
      );
    } else if (update.state !== "error" && update.state !== "unsupported") {
      notify(t("update.upToDate"), "success");
    }
  };

  const install = async () => {
    const ok = await update.install();
    if (!ok && update.error) {
      notify(
        update.error.code === "UPDATE_RESTART"
          ? t("update.restartError")
          : update.error.code === "UPDATE_SECURITY"
            ? t("update.securityError")
            : t("update.installError"),
        "error",
      );
    }
  };

  const openRelease = async () => {
    try {
      await openUrl(UPDATE_RELEASE_URL);
    } catch {
      notify(t("update.openFailed"), "error");
    }
  };

  const releaseAction = (
    <Button variant="secondary" onClick={() => void openRelease()}>
      {portable ? t("update.downloadZip") : t("update.openRelease")}
    </Button>
  );

  const errorTitle =
    update.error?.code === "UPDATE_INSTALL"
      ? t("update.installError")
      : t("update.checkError");

  return (
    <Card>
      <div className="card-header">
        <div>
          <h2>{t("update.title")}</h2>
          <p className="muted small">{t("update.subtitle")}</p>
        </div>
        <div className="badge-row">
          <Badge tone={tone}>{t(stateKey)}</Badge>
          <Button
            variant="secondary"
            loading={update.checking}
            disabled={update.downloading || !update.canAutoUpdate}
            onClick={() => void runCheck()}
          >
            {update.checking ? t("update.checking") : t("update.check")}
          </Button>
        </div>
      </div>

      <div className="form-grid">
        <div className="field">
          <span>
            {t("update.currentVersion", {
              version: update.currentVersion ?? t("update.unknownVersion"),
            })}
          </span>
          <small className="muted">{lastChecked}</small>
          <small className="muted">{t("update.manualHint")}</small>
        </div>
      </div>

      {portable ? (
        <Notice variant="info" action={releaseAction}>
          <strong>{t("update.portableHint")}</strong>
        </Notice>
      ) : null}

      {manualBundle ? (
        <Notice variant="info" action={releaseAction}>
          <strong>{t("update.manualBundleHint")}</strong>
        </Notice>
      ) : null}

      {!portable && isSecurity ? (
        <Notice variant="error" action={releaseAction}>
          <strong>{t("update.securityError")}</strong>
          {update.error ? <span>{update.error.message}</span> : null}
        </Notice>
      ) : null}

      {!portable && update.state === "unsupported" ? (
        <Notice variant="info" action={releaseAction}>
          <strong>{t("update.unsupported")}</strong>
        </Notice>
      ) : null}

      {!portable && update.state === "error" && isOffline ? (
        <Notice variant="info">
          <strong>{t("update.offline")}</strong>
          {update.error ? <span>{update.error.message}</span> : null}
        </Notice>
      ) : null}

      {!portable &&
      update.state === "error" &&
      !isSecurity &&
      !isOffline ? (
        <Notice variant="error">
          <strong>{errorTitle}</strong>
          {update.error ? <span>{update.error.message}</span> : null}
        </Notice>
      ) : null}

      {update.state === "ready" && update.error ? (
        <Notice variant="error">
          <strong>{t("update.restartError")}</strong>
          <span>{update.error.message}</span>
        </Notice>
      ) : null}

      {!portable &&
      !manualBundle &&
      update.state !== "error" &&
      update.state !== "unsupported" &&
      update.lastCheckFailed ? (
        <Notice variant="info">
          <strong>{t("update.offline")}</strong>
          <span>{t("update.silentHint")}</span>
        </Notice>
      ) : null}

      {available ? (
        <div className="field">
          <div className="badge-row">
            <Badge tone="info">
              {t("update.availableVersion", { version: available.version })}
            </Badge>
            <span className="muted small">
              {available.date
                ? t("update.published", {
                    date: formatDateTime(available.date, locale),
                  })
                : t("update.dateUnknown")}
            </span>
          </div>
          <strong>{t("update.notes")}</strong>
          {notes.length ? (
            <ul className="service-list">
              {notes.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ul>
          ) : (
            <small className="muted">{t("update.noNotes")}</small>
          )}
          <div className="form-actions">
            {!update.securityBlocked ? (
              <Button
                variant="primary"
                loading={update.downloading}
                disabled={update.checking || config.dirty}
                onClick={() => void install()}
              >
                {update.state === "ready"
                  ? t("update.restart")
                  : update.downloading
                    ? t("update.downloading")
                    : t("update.download")}
              </Button>
            ) : null}
            {!update.securityBlocked ? (
              <Button variant="ghost" onClick={() => update.dismiss()}>
                {update.downloading ? t("common.cancel") : t("update.dismiss")}
              </Button>
            ) : null}
          </div>
          {config.dirty ? (
            <small className="muted">{t("update.dirtyDraft")}</small>
          ) : null}
          {update.state === "ready" && !update.error ? (
            <small className="muted">{t("update.readyHint")}</small>
          ) : null}
          {update.downloading ? (
            <div className="sync-progress" aria-live="polite">
              <progress max={100} value={percent ?? undefined} />
              <span className="muted small">
                {percent === null
                  ? t("update.progressUnknown")
                  : t("update.progress", { percent })}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
});
