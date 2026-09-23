import { getApplicantContext } from "@/features/profile/context";
import { requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["what", "where"],
  properties: {
    what: { type: "string" },
    where: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You suggest a starting job-search query for the applicant described below.
"what" is a short role/keywords phrase (e.g. "senior backend engineer", "product designer") —
their most recent or clearly strongest role from the CV/Personal Legend. Pick ONE single title:
never join multiple roles or technologies with "/", "," or parentheses (e.g. never "Full-Stack
Developer / Backend Engineer (Go, Python, React)") — that reads as a combined AND-match to a
literal keyword search and returns nothing. "where" is a location (city, region, or country) —
their stated city/country if given, else "".
Output only the two fields, no explanation.`;

/**
 * spec_5 section C: "let the [Adzuna] search settings auto-fill from the CV
 * when left empty" — this is that auto-fill, generalized to every provider
 * so opening the Job Search screen never starts from a totally blank query.
 * Deliberately not run automatically on every open (it's a paid API call);
 * the Job Search screen calls it once, only when both fields are empty.
 */
export async function suggestSearchQuery(): Promise<{ what: string; where: string }> {
  const { profile, cvText, personalLegend } = await getApplicantContext();

  const userPrompt = JSON.stringify(
    {
      profileCity: profile.city,
      profileCountry: profile.country,
      cvText,
      personalLegend,
    },
    null,
    2,
  );

  const result = await requestStructured<{ what: string; where: string }>({
    schemaName: "job_search_query_suggestion",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { what: string; where: string },
  });

  return {
    what: result.what,
    where: result.where || [profile.city, profile.country].filter(Boolean).join(", "),
  };
}
