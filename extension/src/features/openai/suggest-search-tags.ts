import { getCvMeta, getLanguageLevels, getPersonalLegend, getProfile } from "@/features/profile/repository";
import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tags"],
  properties: {
    tags: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM_PROMPT = `You generate keyword search tags for Adzuna's job-search API, grounded in
the candidate's real background below. Adzuna does a literal keyword/phrase match, not a
semantic one, so a single title misses postings phrased differently — you compensate by
providing several short phrase variations instead.

Rules:
- Base every tag on their actual, strongest-fitting job title/field from the CV/Personal
  Legend — never invent a title or field they don't have.
- Include common synonym variations of that title (e.g. "developer" / "engineer" /
  "programmer" style alternates, and a seniority-qualified variant when their level is clear).
- For EACH language listed in "languages" below, also include that same title translated into
  that language using the natural job-title term a native speaker would search with (not a
  literal word-for-word translation) — so postings written in that language are matched too.
- Each tag is a short phrase (1-4 words), not a sentence.
- Deduplicate. Return 3-8 tags total, most relevant first.
- Output only the tags, no explanation.`;

/**
 * Adzuna's `what` is a literal keyword search, not a prompt — a single
 * derived title (`suggest-search-query.ts`) misses postings phrased
 * differently or written in another language the candidate speaks. This
 * generates a small set of title variations (synonyms + per spoken-language
 * translations, from `getLanguageLevels`) so `job-search/adzuna-provider.ts`
 * can run one search per tag and merge the results, instead of gambling on
 * Adzuna's undocumented `what_or` word-vs-phrase OR semantics (see that
 * file's header comment for why `what_or` itself is avoided).
 */
export async function suggestSearchTags(): Promise<string[]> {
  const [profile, cvMeta, legend, languageLevels] = await Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getLanguageLevels(),
  ]);

  const userPrompt = JSON.stringify(
    {
      profileCity: profile.city,
      profileCountry: profile.country,
      cvText: cvMeta?.text ?? "",
      personalLegend: legend?.content ?? "",
      languages: languageLevels.map((l) => l.language),
    },
    null,
    2,
  );

  const result = await requestStructured<{ tags: string[] }>({
    schemaName: "job_search_tags",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { tags: string[] },
  });

  return result.tags.map((t) => t.trim()).filter(Boolean);
}
