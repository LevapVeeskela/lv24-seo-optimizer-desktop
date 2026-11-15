import { save } from "@tauri-apps/plugin-dialog";
import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { writeTextFile } from "@/shared/desktop/files";
import { toAppError, type AppError } from "@/shared/lib/errors";
import { copyText } from "./clipboard";
import { buildAgentPrompt } from "./prompt";
import { agentTaskFilename } from "./queue";

export type ExportOutcome = "exported" | "canceled" | "failed";

export interface ExportResult {
  status: ExportOutcome;
  /** Why the native write failed; the shell's PATH_NOT_ALLOWED is actionable. */
  error?: AppError;
}

/** A save dialog may return a bare path; the shell only accepts known extensions. */
export function ensureMarkdownPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return trimmed;
  }
  const name = trimmed.split(/[\\/]/).pop() ?? "";
  return /\.[^./\\]+$/.test(name) ? trimmed : `${trimmed}.md`;
}

/**
 * True when `path` is `root` or below it. This is the save dialog's pre-check;
 * the shell's canonicalized `write_text_file` allow-list stays authoritative.
 * Windows paths compare case-insensitively, so both sides are normalized.
 */
export function isWithinDirectory(path: string, root: string): boolean {
  const normalize = (value: string) =>
    value.replace(/[\\/]+/g, "/").replace(/\/+$/, "").toLowerCase();
  const candidate = normalize(path);
  const base = normalize(root);
  if (!base) {
    return false;
  }
  return candidate === base || candidate.startsWith(`${base}/`);
}

/** Copy the exact brief an external agent should receive. */
export async function copyRecommendationPrompt(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
): Promise<boolean> {
  return copyText(buildAgentPrompt(recommendation, property, period));
}

function joinPath(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/**
 * Save the same brief as Markdown through the native dialog and the shell's
 * allow-listed `write_text_file`, so a denied write is visible to the user
 * instead of a Blob download that can fail silently.
 *
 * The dialog starts in the app export root and a path outside it is rejected
 * before the write, so the user never picks a folder the shell will refuse.
 *
 * `canceled` is not an error: closing the dialog must not raise a toast.
 */
export async function exportRecommendationPrompt(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
  options: { defaultDir?: string | null } = {},
): Promise<ExportResult> {
  const filename = agentTaskFilename(recommendation.id);
  const exportRoot = options.defaultDir?.trim() || null;
  try {
    const selected = await save({
      title: filename,
      defaultPath: exportRoot
        ? joinPath(exportRoot, filename)
        : filename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!selected) {
      return { status: "canceled" };
    }
    const target = ensureMarkdownPath(selected);
    if (exportRoot && !isWithinDirectory(target, exportRoot)) {
      // Fail before the write: the shell would reject the path anyway, and the
      // user should learn why without a failed export record.
      return {
        status: "failed",
        error: {
          code: "PATH_NOT_ALLOWED",
          message: `Exports must be saved under ${exportRoot}.`,
          retryable: false,
        },
      };
    }
    await writeTextFile(
      target,
      buildAgentPrompt(recommendation, property, period),
    );
    return { status: "exported" };
  } catch (error) {
    return { status: "failed", error: toAppError(error, "EXPORT_WRITE") };
  }
}
