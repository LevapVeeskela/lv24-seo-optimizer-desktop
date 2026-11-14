import { useId, useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { copyText } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/Button";
import { InlineError } from "@/shared/ui/InlineError";

/** Failure wins over the transient "copied" label and the idle label. */
export function copyButtonLabel({
  copied,
  failed,
  label,
  copiedLabel,
  failedLabel,
}: {
  copied: boolean;
  failed: boolean;
  label: string;
  copiedLabel: string;
  failedLabel: string;
}): string {
  if (failed) {
    return failedLabel;
  }
  return copied ? copiedLabel : label;
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  failedTitle,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  /** Localized message shown when the clipboard write is rejected. */
  failedTitle?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorId = useId();

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = async () => {
    setFailed(false);
    const ok = await copyText(value);
    if (!ok) {
      // Clipboard denial is a real failure: render it, not just a tooltip.
      setCopied(false);
      setFailed(true);
      return;
    }
    setCopied(true);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  const failure = failed ? (failedTitle ?? t("common.clipboardUnavailable")) : null;

  return (
    <>
      <Button
        variant={failed ? "danger" : "secondary"}
        onClick={() => void copy()}
        aria-live="polite"
        aria-describedby={failure ? errorId : undefined}
        title={failure ?? undefined}
      >
        {copyButtonLabel({
          copied,
          failed,
          label,
          copiedLabel,
          failedLabel: failure ?? t("common.clipboardUnavailable"),
        })}
      </Button>
      {failure ? <InlineError id={errorId}>{failure}</InlineError> : null}
    </>
  );
}
