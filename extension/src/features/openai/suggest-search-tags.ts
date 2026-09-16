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
the candidate's real background below. Per Adzuna's own docs
(https://developer.adzuna.com/docs/search), "what" is a single literal keyword/phrase match, not
a semantic search and not a boolean query — so ONE combined tag naming several technologies or
role variants (e.g. "Full-Stack Developer / Backend Engineer (Go, Python, React)") matches
nothing. You compensate by generating a small cross-product of short, atomic tags instead, each
run as its own separate search and merged afterwards.

Method — build the tags as a cross-product, exactly like this worked example for a candidate
whose strongest stack is Go and who also does full-stack/backend work:
  golang developer, go developer, go engineer, golang engineer,
  backend engineer, backend developer, fullstack engineer, fullstack developer,
  software engineer, software developer
That is: {primary technology + its common short aliases} × {developer, engineer}, PLUS
{their role-shape words, e.g. backend / fullstack / frontend / mobile / data — whichever
genuinely apply, without a technology} × {developer, engineer}, PLUS a generic "software
developer" / "software engineer" fallback pair.

Rules:
- Base every tag on their actual, strongest-fitting technology/field from the CV/Personal
  Legend — never invent a technology, role-shape, or seniority they don't have.
- Identify the ONE primary technology (e.g. "Go") plus its common short aliases people actually
  search with (e.g. "Golang") — do not alias unrelated technologies together.
- Each tag pairs exactly one technology-or-role-shape word with exactly one of "developer" /
  "engineer" (add "programmer" only if that's a genuinely common term for that stack). Never put
  two technologies, or a technology and a role-shape, in the same tag.
- If the CV shows a clear secondary technology/stack, budget permitting, add its own couple of
  tags the same way — still never combined with the primary one in a single tag.
- For EACH language listed in "languages" below (skip English), also include ONE of the
  strongest-technology tags translated into that language using the natural job-title term a
  native speaker would search with (not a literal word-for-word translation).
- Each tag is 1-3 words, lowercase, and never contains "/", ",", "(", ")", or a seniority
  qualifier ("senior", "junior", etc.).
- Deduplicate. Return 6-12 tags total, most relevant first.
- Output only the tags, no explanation.`;

/**
 * Adzuna's `what` is a literal keyword/phrase search, not a prompt (confirmed
 * against https://developer.adzuna.com/docs/search — `what_or`/`what_and`
 * live only in the JS-rendered `/activedocs` Swagger UI this extension can't
 * fetch, so their exact word-vs-phrase OR semantics stay unverified and are
 * deliberately not used; see `adzuna-provider.ts`'s header comment). A single
 * derived title (`suggest-search-query.ts`) either misses postings phrased
 * differently/in another language, or — worse — combines several
 * technologies/role variants into one AND-matched phrase that returns
 * nothing (e.g. "Full-Stack Developer / Backend Engineer (Go, Python,
 * React)"). This generates a small cross-product of atomic single-concept
 * tags instead (technology × developer/engineer, role-shape ×
 * developer/engineer, plus per spoken-language variants from
 * `getLanguageLevels`) so `job-search/adzuna-provider.ts` can run one search
 * per tag and merge the results.
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
