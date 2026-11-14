/**
 * Clipboard write with a legacy textarea fallback for webviews where the
 * async Clipboard API is missing or denied. Returns `false` instead of
 * throwing so the caller can show a visible failure.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      typeof navigator.clipboard?.writeText === "function"
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // WebKitGTK can expose the async API yet reject the write (permission or
    // focus); fall through to the legacy selection path.
  }

  if (typeof document === "undefined") {
    return false;
  }
  const previousFocus =
    typeof HTMLElement !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let area: HTMLTextAreaElement | null = null;
  try {
    area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "0";
    area.style.left = "0";
    area.style.opacity = "0";
    document.body.appendChild(area);
    // WebKitGTK needs an explicit range; `select()` alone is not enough in
    // every webview version.
    area.focus();
    area.select();
    area.setSelectionRange(0, area.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area?.remove();
    // The temporary textarea steals focus; return it to the copy control so
    // keyboard users do not land on <body> after a fallback copy.
    if (previousFocus?.isConnected) {
      previousFocus.focus();
    }
  }
}
