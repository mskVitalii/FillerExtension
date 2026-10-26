/**
 * The keyword half of the two AI passes that read a posting
 * (`openai/analyze-job-brief.ts` and `job-extraction/ai-fallback.ts`) —
 * one schema and one set of rules so the two can't drift apart.
 */

export const KEYWORDS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["text", "kind", "matchesProfile"],
    properties: {
      text: { type: "string" },
      kind: { type: "string", enum: ["hard", "soft"] },
      matchesProfile: { type: "boolean" },
    },
  },
} as const;

/** `source` names where the verbatim text must come from, e.g. `the posting text` or `"pageText"`. */
export function keywordRules(source: string): string {
  return `KEYWORDS
- Pick the SKILLS the posting asks for, and nothing else. Each one is either:
  - "hard": a technical skill, tool, technology, programming language, framework, platform,
    method or domain expertise (e.g. "TypeScript", "Kubernetes", "C++", ".NET", "CI/CD",
    "SQL", "machine learning", "financial modelling", "Figma", "Scrum");
  - "soft": a real interpersonal/working skill (e.g. "communication", "mentoring",
    "stakeholder management", "problem-solving", "ownership").
- NEVER return anything that is not a skill. In particular, never return:
  - the company name, its products' brand names used as a name, or any other organization;
  - cities, countries, regions, addresses, time zones;
  - work modes and contract terms ("remote", "hybrid", "on-site", "full-time", "contract");
  - benefits and pay ("salary", "equity", "health insurance", "30 days vacation", "bonus");
  - job titles and seniority ("Senior Backend Engineer", "Team Lead", "junior");
  - years of experience, degrees, certificates as such ("5+ years", "Bachelor's degree");
  - spoken languages ("English", "German") — those are reported separately above;
  - generic words ("team", "experience", "work", "product", "environment", "opportunity",
    "fast-paced environment", "passion").
- Every keyword's "text" MUST be copied VERBATIM from ${source} — the exact same characters
  and casing, not a paraphrase, synonym, or translation — because the extension re-finds this
  exact text on the page to highlight it. A keyword that doesn't appear verbatim is useless.
- Prefer short phrases: single words or 2-3 word phrases, never sentences.
- Return up to 15, most important first. Fewer is fine: return an empty array rather than
  padding the list with anything from the NEVER list above.
- No duplicates, and no two keywords where one is a substring of the other (keep the more
  specific/longer one).
- Set "matchesProfile" to true when the applicant's profile/cvText/personalLegend shows they
  already have, use, or meet that skill — false when the posting asks for it but nothing in
  the applicant's material supports it. Judge substance, not exact wording (e.g.
  "Kubernetes" counts as a match if the CV mentions "container orchestration with K8s" or
  "EKS"). When genuinely unsure, set it to false — this flags a possible gap for the
  applicant to address rather than silently hiding it.`;
}
