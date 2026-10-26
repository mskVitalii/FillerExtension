import type { JobSearchQuery } from "@/types/job-search";
import { gradesRefinement } from "./grades";
import { negativeInstruction } from "./negative";

/** This search's own constraints, as one prompt line for the AI-backed providers (OpenAI and Tavily); "" when none are set. */
export function searchRefinements(query: JobSearchQuery): string {
  return [
    query.what ? `Role/keywords focus: "${query.what}".` : "",
    query.where ? `Location: "${query.where}".` : "",
    gradesRefinement(query.grades),
    query.remoteOnly ? "Prefer remote-friendly roles." : "",
    negativeInstruction(query.negative),
  ]
    .filter(Boolean)
    .join(" ");
}
