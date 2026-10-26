import type { Job, JobBrief, JobKeyword, JobLanguageInfo } from "@/types/job";
import { CEFR_LEVELS } from "@/lib/language-level";
import { getApplicantContext } from "@/features/profile/context";
import { getExtractionModel, requestStructured } from "@/features/openai/client";
import { KEYWORDS_SCHEMA, keywordRules } from "@/features/keywords/prompt";
import { filterJobKeywords } from "@/features/keywords/filter";
import { fieldsToFill, mergeCompletion, type JobCompletion } from "./completion";

/** Language + keywords — the brief half shared by the full extraction and the completion below. */
const BRIEF_PROPERTIES = {
  postingLanguages: { type: "array", items: { type: "string" } },
  languageRequirements: {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["language", "level"],
      properties: {
        language: { type: "string" },
        level: { type: ["string", "null"], enum: [...CEFR_LEVELS, null] },
      },
    },
  },
  keywords: KEYWORDS_SCHEMA,
} as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "position",
    "location",
    "description",
    "requirements",
    "responsibilities",
    "salary",
    "techStack",
    "contact",
    "postingLanguages",
    "languageRequirements",
    "keywords",
  ],
  properties: {
    company: { type: "string" },
    position: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    requirements: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    salary: { type: ["string", "null"] },
    techStack: { type: "array", items: { type: "string" } },
    contact: { type: ["string", "null"] },
    ...BRIEF_PROPERTIES,
  },
} as const;

const LANGUAGE_RULES = `LANGUAGE
- postingLanguages: the language(s) the posting text itself is written in (e.g. "English").
- languageRequirements: any language the posting explicitly asks the applicant to know or be
  proficient in, with a level. Map loose phrasing to the nearest CEFR level (A1-C2, or "Native"
  for "native speaker"/"muttersprachlich") when you reasonably can — e.g. "fluent", "professional
  working proficiency" -> "C1"; "conversational" -> "B1". If a language is mentioned but no level
  can be reasonably inferred, set level to null. Do not invent a requirement that isn't stated in
  the text. If nothing is stated, return an empty array.`;

const SYSTEM_PROMPT = `You read the visible text of a job-posting page and do two things with it
in one pass: extract the structured posting fields, and analyze the result for language and
keywords — against the applicant profile/CV/Personal Legend given below.

EXTRACTION
- Only use information present in "pageText"; leave a field empty/null if unknown.
- For "contact", prefer a named recruiter/hiring manager's email address or LinkedIn
  profile/company URL if one is mentioned, copied VERBATIM (exact characters); otherwise null.

${LANGUAGE_RULES}

${keywordRules('"pageText"')}`;

interface RawResult {
  company: string;
  position: string;
  location: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  salary: string | null;
  techStack: string[];
  contact: string | null;
  postingLanguages: string[];
  languageRequirements: JobLanguageInfo["requirements"];
  keywords: JobKeyword[];
}

/**
 * For a job pasted in as raw text, which has no DOM pass to begin with — a DOM-insufficient page
 * goes through `completeJobWithAiAndBrief` below instead. Sends text only, never page HTML.
 *
 * Folds the brief analysis (language + keywords, normally `analyze-job-brief.ts`'s job) into the
 * same call instead of a second round trip right after: extraction already has to read the full
 * posting text once, and the applicant context needed to judge keywords/language is the same
 * context this call already needs for nothing else — splitting it back into two requests would
 * just pay for that same context twice. The DOM-sufficient path (the common case) is untouched
 * and still costs exactly one call (`analyzeJobBrief` alone).
 */
export async function extractJobWithAiAndBrief(
  visibleText: string,
  url: string,
): Promise<{ job: Job; brief: JobBrief }> {
  const context = await getApplicantContext();

  const userPrompt = JSON.stringify(
    {
      profile: context.profile,
      cvText: context.cvText,
      personalLegend: context.personalLegend,
      pageText: visibleText.slice(0, 12000),
    },
    null,
    2,
  );

  const result = await requestStructured<RawResult>({
    schemaName: "job_extraction_and_brief",
    schema: SCHEMA,
    model: await getExtractionModel(),
    // Copying fields out of the page text is mechanical — long thinking only delays the panel.
    reasoningEffort: "low",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as RawResult,
  });

  const job: Job = {
    company: result.company,
    position: result.position,
    location: result.location,
    description: result.description,
    requirements: result.requirements,
    responsibilities: result.responsibilities,
    salary: result.salary,
    techStack: result.techStack,
    contact: result.contact,
    url,
  };
  const brief: JobBrief = {
    language: { postingLanguages: result.postingLanguages, requirements: result.languageRequirements },
    keywords: filterJobKeywords(result.keywords, job),
    // The extraction above already had its one shot at `contact` — nothing further to add.
    contact: null,
  };
  return { job, brief };
}

const COMPLETION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "position",
    "location",
    "requirements",
    "responsibilities",
    "salary",
    "techStack",
    "contact",
    "postingLanguages",
    "languageRequirements",
    "keywords",
  ],
  properties: {
    company: { type: "string" },
    position: { type: "string" },
    location: { type: "string" },
    requirements: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    salary: { type: ["string", "null"] },
    techStack: { type: "array", items: { type: "string" } },
    contact: { type: ["string", "null"] },
    ...BRIEF_PROPERTIES,
  },
} as const;

const COMPLETION_PROMPT = `You read the visible text of a job-posting page. It was already parsed
without AI: "knownFields" holds what that found. Fill in what it missed, and analyze the posting
for language and keywords — against the applicant profile/CV/Personal Legend given below.

FIELDS
- Fill only the fields named in "fieldsToFill". For every other posting field return "" / [] /
  null — those are kept from the page as they are. Never re-type the posting's description.
- position: the job title alone — no company, job board or "| LinkedIn"-style suffix.
- company: the hiring company, not the job board or recruiting platform hosting the page.
- location: as written in the posting; "" if none.
- requirements, responsibilities: at most 8 items each, each a short phrase (12 words or fewer),
  not copied paragraphs.
- techStack: technology names only.
- contact: a named recruiter/hiring manager's email address or LinkedIn profile/company URL,
  copied VERBATIM (exact characters); otherwise null.
- Only use information present in "pageText"; leave a field empty/null if unknown.

${LANGUAGE_RULES}

${keywordRules('"pageText"')}`;

type RawCompletion = JobCompletion & Pick<RawResult, "postingLanguages" | "languageRequirements" | "keywords">;

/**
 * Completes a DOM-insufficient extraction (spec section 10) — usually a missing company. The Side
 * Panel already shows the DOM result; this fills only the missing fields plus the brief, and keeps
 * the description from the page, so the model writes a few dozen tokens instead of the whole
 * posting again (that re-typing was most of the old fallback's latency).
 */
export async function completeJobWithAiAndBrief(dom: Job, pageText: string): Promise<{ job: Job; brief: JobBrief }> {
  const context = await getApplicantContext();
  const fields = fieldsToFill(dom);
  const text = pageText || dom.description;

  const userPrompt = JSON.stringify(
    {
      profile: context.profile,
      cvText: context.cvText,
      personalLegend: context.personalLegend,
      knownFields: {
        position: dom.position,
        company: dom.company,
        location: dom.location,
        salary: dom.salary,
        contact: dom.contact,
      },
      fieldsToFill: fields,
      pageText: text.slice(0, 12000),
    },
    null,
    2,
  );

  const result = await requestStructured<RawCompletion>({
    schemaName: "job_completion_and_brief",
    schema: COMPLETION_SCHEMA,
    model: await getExtractionModel(),
    reasoningEffort: "low",
    systemPrompt: COMPLETION_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as RawCompletion,
  });

  const job = mergeCompletion(dom, result, fields, text);
  const brief: JobBrief = {
    language: { postingLanguages: result.postingLanguages, requirements: result.languageRequirements },
    keywords: filterJobKeywords(result.keywords, job),
    contact: null,
  };
  return { job, brief };
}
