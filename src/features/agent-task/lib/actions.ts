import { save } from "@tauri-apps/plugin-dialog";
import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { writeTextFile } from "@/shared/desktop/files";
import { copyText } from "./clipboard";
import { buildAgentPrompt } from "./prompt";
import { agentTaskFilename } from "./queue";

export type ExportOutcome = "exported" | "canceled" | "failed";

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
 * `canceled` is not an error: closing the dialog must not raise a toast.
 */
export async function exportRecommendationPrompt(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
  options: { defaultDir?: string | null } = {},
): Promise<ExportOutcome> {
  const filename = agentTaskFilename(recommendation.id);
  try {
    const selected = await save({
      title: filename,
      defaultPath: options.defaultDir
        ? joinPath(options.defaultDir, filename)
        : filename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!selected) {
      return "canceled";
    }
    await writeTextFile(
      selected,
      buildAgentPrompt(recommendation, property, period),
    );
    return "exported";
  } catch {
    return "failed";
  }
}
