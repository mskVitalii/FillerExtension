import type { JobSearchQuery } from "@/types/job-search";
import { gradesRefinement } from "./grades";
import { negativeInstruction } from "./negative";
import { searchTerms } from "./terms";

function termsRefinement(query: JobSearchQuery): string {
  const terms = searchTerms(query);
  if (terms.length === 0) return "";
  if (terms.length === 1) return `Role/keywords focus: "${terms[0]}".`;
  return `Role/keywords: any of ${terms.map((t) => `"${t}"`).join(", ")}.`;
}

/** This search's own constraints, as one prompt line for the OpenAI web search; "" when none are set. Tavily gets keyword queries instead (`tavily-provider.ts`). */
export function searchRefinements(query: JobSearchQuery): string {
  return [
    termsRefinement(query),
    query.where ? `Location: "${query.where}".` : "",
    gradesRefinement(query.grades),
    query.remoteOnly ? "Prefer remote-friendly roles." : "",
    negativeInstruction(query.negative),
  ]
    .filter(Boolean)
    .join(" ");
}
