import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";
import { copyText } from "./clipboard";
import { downloadMarkdownFile } from "./download";
import { buildAgentPrompt } from "./prompt";
import { agentTaskFilename } from "./queue";

/** Copy the exact brief an external agent should receive. */
export async function copyRecommendationPrompt(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
): Promise<boolean> {
  return copyText(buildAgentPrompt(recommendation, property, period));
}

/** Download the same brief as a Markdown file. */
export function exportRecommendationPrompt(
  recommendation: Recommendation,
  property: string | null | undefined,
  period: RecommendationPeriod | null | undefined,
): boolean {
  return downloadMarkdownFile(
    agentTaskFilename(recommendation.id),
    buildAgentPrompt(recommendation, property, period),
  );
}
