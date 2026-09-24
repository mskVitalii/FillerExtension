import type { CvVariable } from "@/types/cv-template";
import { CV_MARKDOWN_SYNTAX } from "@/features/cv-template/markdown";
import { extractVariableNames } from "@/features/cv-template/template";
import { getCoverLetterModel, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "variables"],
  properties: {
    content: { type: "string" },
    variables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "description", "options", "mode"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["choice", "free"] },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You turn an applicant's CV (plain text extracted from a PDF, so line
breaks and spacing may be broken) into an adaptable CV template.

Output "content" in exactly this syntax:
${CV_MARKDOWN_SYNTAX}

Rules for "content":
- Keep every fact, date, company, number and wording of the original. Only restore
  structure (headings, bullets, "left || right" for dates/locations) and fix broken
  line wrapping. Do not add, embellish, shorten or reorder content.
- Replace the parts that should change per job posting with {{placeholders}}:
  - {{city}}: the applicant's own location in the header/contacts.
  - {{job_position}}: the headline/target title (e.g. under the name, in the summary).
    Leave past job titles in the experience section as they are unless the applicant
    asks otherwise.
  - {{main_language}}: wherever the CV names the applicant's primary programming
    language in a way that can be swapped for another one they also know (summary,
    headline, skills line).
  - {{keywords}}: a skills/technologies line that should be tuned per posting.
  Add other placeholders only if something clearly varies per application. Use
  snake_case names. Use the same placeholder everywhere the same thing appears.

Rules for "variables" (one per placeholder used in "content"):
- "description": one or two sentences telling a later AI step how to choose the value
  from a job posting.
- "options": realistic variants taken from the CV itself (e.g. the programming
  languages the applicant actually lists; title variants built from roles they have
  held, like "Backend Engineer", "Full-Stack Developer"). First option = what the
  original CV says.
- "mode": "choice" when the value must be one of the options (main_language,
  job_position); "free" when options are only examples (city, keywords).`;

export interface TemplatizedCv {
  content: string;
  variables: CvVariable[];
}

/** Plain CV text → Markdown template + placeholder definitions. Uses the cover-letter tier: the output *is* the applicant's document. */
export async function templatizeCv(cvText: string): Promise<TemplatizedCv> {
  const result = await requestStructured<TemplatizedCv>({
    schemaName: "cv_template",
    schema: SCHEMA,
    model: await getCoverLetterModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: cvText.slice(0, 30_000),
    parse: (raw) => JSON.parse(raw) as TemplatizedCv,
  });
  // Drop definitions for placeholders the model described but never actually used.
  const used = new Set(extractVariableNames(result.content));
  return { content: result.content, variables: result.variables.filter((v) => used.has(v.name)) };
}
