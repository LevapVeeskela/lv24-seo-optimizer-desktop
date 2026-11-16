import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { buildAgentPrompt } from "@/features/agent-task/lib/prompt";
import { agentTaskFilename } from "@/features/agent-task/lib/queue";

export interface BulkExportFile {
  id: string;
  path: string;
  content: string;
}

/** Join the shell export root and a filename with the root's separator. */
export function joinExportPath(directory: string, filename: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.replace(/[\\/]+$/, "")}${separator}${filename}`;
}

/** Visible recommendations that are not in the agent queue yet. */
export function pendingQueueIds(
  items: readonly Recommendation[],
  isQueued: (id: string) => boolean,
): string[] {
  return items.filter((item) => !isQueued(item.id)).map((item) => item.id);
}

/**
 * One Markdown file per visible recommendation, written into the shell export
 * root. The shell's `write_text_file` allow-list accepts that root, so bulk
 * export needs no per-item save dialog and no new write path.
 */
export function planBulkExport(
  items: readonly Recommendation[],
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
  exportDir: string,
): BulkExportFile[] {
  return items.map((item) => ({
    id: item.id,
    path: joinExportPath(exportDir, agentTaskFilename(item.id)),
    content: buildAgentPrompt(item, property, period),
  }));
}
