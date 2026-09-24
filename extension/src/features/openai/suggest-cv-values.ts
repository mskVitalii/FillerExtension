import type { Job } from "@/types/job";
import type { CvTemplate, CvValueSuggestion, CvVariable } from "@/types/cv-template";
import { getApplicantContext } from "@/features/profile/context";
import { defaultValue, extractVariableNames, findOptionsInPosting } from "@/features/cv-template/template";
import { getSupportModel, requestStructured } from "./client";
import { stripEmDashes } from "./house-style";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["values"],
  properties: {
    values: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "value", "reason"],
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You adapt an applicant's CV template to one specific job posting by
choosing a value for each {{placeholder}} in it.

Each variable comes with:
- "description": the applicant's own instruction for what the placeholder means and
  how to choose it. Follow it.
- "mode": "choice" means "value" MUST be exactly one of "options", copied verbatim
  (same spelling, same case, same line breaks). "free" means "options" are only
  examples of the expected shape and length; write the value that fits this posting
  in that same shape (e.g. a city name, a comma-separated list).
- "foundInPosting": options that literally occur in the posting text, most frequent
  first. A strong hint, not an order: the role's actual focus matters more than a
  passing mention.

Rules:
- Pick what makes this CV the closest honest match for this posting: its title, its
  location, its main technology, the vocabulary it uses.
- Honesty: never make the CV claim a skill, technology or experience the applicant's
  CV text / Personal Legend doesn't support, unless the variable's description
  explicitly asks for it. For list-like values, prefer terms that are both in the
  posting and supported by the applicant's background.
- Write the value in the same language as the surrounding template text.
- Return one entry per variable given, using its exact "name".
- "reason": one short sentence (max ~15 words) on why this value fits the posting.
- Plain text only, no markdown, no em dashes.`;

/** Case-insensitive/whitespace-tolerant match back onto an option, so a `choice` value never drifts from the option list. */
function snapToOption(value: string, variable: CvVariable): string | null {
  const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
  const target = normalize(value);
  return variable.options.find((option) => normalize(option) === target) ?? null;
}

/**
 * Picks every placeholder's value for `job` in one call (the support-model
 * tier — this is structured selection, not prose). A `choice` answer that
 * doesn't match an option falls back to the offline heuristic instead of
 * leaking an invented variant into the PDF.
 */
export async function suggestCvValues(job: Job, template: CvTemplate): Promise<CvValueSuggestion[]> {
  const usedNames = new Set(extractVariableNames(template.content));
  const variables = template.variables.filter((v) => usedNames.has(v.name));
  if (variables.length === 0) return [];

  const context = await getApplicantContext();
  const payload = {
    variables: variables.map((v) => ({
      name: v.name,
      mode: v.mode,
      description: v.description,
      options: v.options,
      foundInPosting: findOptionsInPosting(v.options, job),
    })),
    template: template.content.slice(0, 12_000),
    job: {
      position: job.position,
      company: job.company,
      location: job.location,
      techStack: job.techStack,
      requirements: job.requirements,
      responsibilities: job.responsibilities,
      description: job.description.slice(0, 8_000),
    },
    applicant: {
      cvText: context.cvText.slice(0, 12_000),
      personalLegend: context.personalLegend.slice(0, 8_000),
      city: context.profile.city,
      country: context.profile.country,
    },
  };

  const result = await requestStructured<{ values: CvValueSuggestion[] }>({
    schemaName: "cv_template_values",
    schema: SCHEMA,
    model: await getSupportModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(payload, null, 2),
    parse: (raw) => JSON.parse(raw) as { values: CvValueSuggestion[] },
  });

  return variables.map((variable) => {
    const answer = result.values.find((v) => v.name === variable.name);
    if (!answer) return { name: variable.name, value: defaultValue(variable, job), reason: "" };
    if (variable.mode === "choice" && variable.options.length > 0) {
      const snapped = snapToOption(answer.value, variable);
      if (!snapped) return { name: variable.name, value: defaultValue(variable, job), reason: "" };
      return { name: variable.name, value: snapped, reason: stripEmDashes(answer.reason) };
    }
    return { name: variable.name, value: stripEmDashes(answer.value), reason: stripEmDashes(answer.reason) };
  });
}
