import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/shared/i18n";
import { Button } from "@/shared/ui/Button";

export function CopyButton({
  value,
  label,
  copiedLabel,
  failedTitle,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  /** Localized title shown when the clipboard write is rejected. */
  failedTitle?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Button
      variant="secondary"
      onClick={() => void copy()}
      aria-live="polite"
      title={failed ? (failedTitle ?? t("common.clipboardUnavailable")) : undefined}
    >
      {copied ? copiedLabel : label}
    </Button>
  );
}
