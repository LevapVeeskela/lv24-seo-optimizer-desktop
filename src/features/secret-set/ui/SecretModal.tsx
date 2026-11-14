import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { Badge } from "@/shared/ui/Badge";
import { Button } from "@/shared/ui/Button";
import { Field } from "@/shared/ui/Field";
import { Input } from "@/shared/ui/Input";
import { Notice } from "@/shared/ui/Notice";
import { Select } from "@/shared/ui/Select";
import { AUTH_PROVIDERS, CopyButton } from "@/entities/config";
import {
  AUTH_DELETE_AVAILABLE,
  AUTH_SET_AVAILABLE,
  SECRET_PROVIDER_KEYS,
  authDeleteCommand,
  authSetCommand,
  isSecretEditable,
  removeSecret,
  secretPresence,
  secretSourceKey,
  storeSecret,
} from "@/features/secret-set/model/SecretStore";
import type {
  AuthProvider,
  AuthProviderStatus,
} from "@/entities/config/model/types";

interface ModalMessage {
  text: string;
  variant: "info" | "error";
}

export function SecretModal({
  open,
  provider,
  entries,
  configPath,
  onClose,
  onChanged,
}: {
  open: boolean;
  provider: AuthProvider | null;
  entries: readonly AuthProviderStatus[];
  configPath: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const inputId = useId();
  const providerId = useId();
  // Seed from the row that opened the dialog so the first paint is already the
  // requested provider; the effect below still resets it on reopen.
  const [selected, setSelected] = useState<AuthProvider>(provider ?? "gsc");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ModalMessage | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const status = entries.find((entry) => entry.provider === selected);
  const presence = secretPresence(entries, selected);
  const statusKnown = presence !== "unknown";
  const envLocked = !isSecretEditable(status);
  const authAvailable = AUTH_SET_AVAILABLE && !unsupported && !envLocked;

  useEffect(() => {
    if (open) {
      setSelected(provider ?? "gsc");
      setSecret("");
      setMessage(null);
      setUnsupported(false);
    } else {
      setSecret("");
    }
  }, [open, provider]);

  useEffect(() => {
    // A result from the previous workspace must not linger in the dialog.
    setSecret("");
    setMessage(null);
  }, [configPath]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open) {
      if (!dialog.open) {
        restoreFocus.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        dialog.showModal();
      }
      return;
    }
    if (dialog.open) {
      dialog.close();
    }
    const target = restoreFocus.current;
    restoreFocus.current = null;
    if (target?.isConnected) {
      target.focus();
    }
  }, [open]);

  useEffect(
    () => () => {
      const target = restoreFocus.current;
      restoreFocus.current = null;
      if (target?.isConnected) {
        target.focus();
      }
    },
    [],
  );

  const close = () => {
    if (!busy) {
      setSecret("");
      onClose();
    }
  };

  const store = async () => {
    if (!secret.trim()) {
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await storeSecret(selected, secret, configPath);
    setBusy(false);
    setSecret("");
    if (result.ok) {
      setMessage({ text: t("secrets.stored"), variant: "info" });
      onChanged();
      return;
    }
    if (result.unsupported) {
      setUnsupported(true);
    }
    setMessage({
      text: result.unsupported
        ? t("secrets.unsupported")
        : result.message ?? t("secrets.storeFailed"),
      variant: "error",
    });
  };

  const remove = async () => {
    setBusy(true);
    setMessage(null);
    const result = await removeSecret(selected, configPath);
    setBusy(false);
    if (result.ok) {
      setMessage({
        text:
          result.removed === false
            ? t("secrets.removeStillPresent")
            : t("secrets.removed"),
        variant: "info",
      });
      onChanged();
      return;
    }
    if (result.unsupported) {
      setUnsupported(true);
    }
    setMessage({
      text: result.unsupported
        ? t("secrets.removeUnsupported")
        : result.message ?? t("secrets.removeFailed"),
      variant: "error",
    });
  };

  const setCommand = authSetCommand(selected, configPath);
  const deleteCommand = authDeleteCommand(selected, configPath);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      aria-busy={busy || undefined}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{t("secrets.title")}</h2>
        <p className="muted">{t("secrets.subtitle")}</p>
        <Notice variant="info">
          <span>{t("secrets.sharedHint")}</span>
        </Notice>

        <Field id={providerId} label={t("secrets.provider")}>
          <Select
            id={providerId}
            value={selected}
            disabled={busy}
            onChange={(event) => {
              setSelected(event.target.value as AuthProvider);
              setSecret("");
              setMessage(null);
            }}
          >
            {AUTH_PROVIDERS.map((item) => (
              <option key={item} value={item}>
                {t(SECRET_PROVIDER_KEYS[item])}
              </option>
            ))}
          </Select>
        </Field>

        <div className="badge-row">
          <Badge
            tone={
              presence === "present"
                ? "success"
                : presence === "missing"
                  ? "warning"
                  : "neutral"
            }
          >
            {presence === "present"
              ? t("secrets.present")
              : presence === "missing"
                ? t("secrets.missing")
                : t("secrets.unknown")}
          </Badge>
          {statusKnown ? (
            <Badge tone="neutral">
              {t("secrets.source")}: {t(secretSourceKey(status?.source))}
            </Badge>
          ) : null}
          {status?.expires_at ? (
            <Badge tone="info">
              {t("secrets.expires", { value: status.expires_at })}
            </Badge>
          ) : null}
        </div>

        {status?.source === "env" ? (
          <Notice variant="info">
            <span>{t("secrets.envReadOnly")}</span>
          </Notice>
        ) : null}
        {status?.source === "file" ? (
          <Notice variant="info">
            <span>{t("secrets.fileWarning")}</span>
          </Notice>
        ) : null}

        {authAvailable ? (
          <>
            <Field
              id={inputId}
              label={t("secrets.value")}
              hint={t("secrets.valueHint")}
            >
              <Input
                id={inputId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={secret}
                disabled={busy}
                onChange={(event) => setSecret(event.target.value)}
              />
            </Field>
            <div className="form-actions">
              <Button
                variant="primary"
                loading={busy}
                disabled={!secret.trim()}
                onClick={() => void store()}
              >
                {t("secrets.store")}
              </Button>
              {AUTH_DELETE_AVAILABLE && status?.present ? (
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => void remove()}
                >
                  {t("secrets.remove")}
                </Button>
              ) : null}
            </div>
          </>
        ) : envLocked ? null : (
          <Notice variant="info">
            <strong>{t("secrets.cliFallbackTitle")}</strong>
            <span>{t("secrets.cliFallbackHint")}</span>
            <code className="callback">{setCommand}</code>
            <CopyButton
              value={setCommand}
              label={t("secrets.copyCommand")}
              copiedLabel={t("common.copied")}
            />
            {status?.present ? (
              <>
                <span>{t("secrets.removeHint")}</span>
                <code className="callback">{deleteCommand}</code>
                <CopyButton
                  value={deleteCommand}
                  label={t("secrets.copyCommand")}
                  copiedLabel={t("common.copied")}
                />
              </>
            ) : null}
          </Notice>
        )}

        {message ? (
          <Notice variant={message.variant}>
            <span>{message.text}</span>
          </Notice>
        ) : null}

        <div className="dialog-actions">
          <Button variant="secondary" disabled={busy} onClick={close}>
            {t("common.close")}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
