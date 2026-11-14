import type {
  Recommendation,
  RecommendationPeriod,
} from "@/entities/recommendation/model/types";

export const AGENT_TASK_STATUSES = ["draft", "copied", "exported"] as const;

export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

/** A queue item keeps the recommendation snapshot and the prompt context. */
export interface AgentTask {
  id: string;
  recommendation: Recommendation;
  property: string | null;
  period: RecommendationPeriod | null;
  status: AgentTaskStatus;
  createdAt: string;
  updatedAt: string;
}
