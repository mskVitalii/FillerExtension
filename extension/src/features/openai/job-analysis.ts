import type { Job } from "@/types/job";
import { MODEL_LUNA, requestStructured } from "./client";

export interface JobAnalysis {
  keyRequirements: string[];
  relevantExperienceHints: string[];
  suggestedTone: string;
  suggestedFocus: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["keyRequirements", "relevantExperienceHints", "suggestedTone", "suggestedFocus"],
  properties: {
    keyRequirements: { type: "array", items: { type: "string" } },
    relevantExperienceHints: { type: "array", items: { type: "string" } },
    suggestedTone: { type: "string" },
    suggestedFocus: { type: "string" },
  },
} as const;

/**
 * Stage 1 of the cover-letter pipeline (spec section 15): turn the raw job
 * posting into a compact analysis that stage 2 conditions on, instead of
 * cramming extraction + analysis + writing into a single giant prompt.
 */
export async function analyzeJob(job: Job): Promise<JobAnalysis> {
  return requestStructured<JobAnalysis>({
    schemaName: "job_analysis",
    schema: SCHEMA,
    // Slow step in the pipeline (spec_2 item 4) — a smaller model is plenty for
    // structured extraction/analysis, unlike the actual cover-letter prose.
    model: MODEL_LUNA,
    systemPrompt:
      "You analyze job postings for a job-application assistant. Identify the most " +
      "important requirements and what an applicant should emphasize. Do not invent " +
      "details that are not present in the posting.",
    userPrompt: JSON.stringify(job, null, 2),
    parse: (raw) => JSON.parse(raw) as JobAnalysis,
  });
}
