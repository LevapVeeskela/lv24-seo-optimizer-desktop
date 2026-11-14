/** Browser-only Markdown download; no shell or backend dependency. */
export function downloadMarkdownFile(
  filename: string,
  content: string,
): boolean {
  if (
    typeof document === "undefined" ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined"
  ) {
    return false;
  }
  try {
    const blob = new Blob([content], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    if (typeof window !== "undefined") {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } else {
      URL.revokeObjectURL(url);
    }
    return true;
  } catch {
    return false;
  }
}
