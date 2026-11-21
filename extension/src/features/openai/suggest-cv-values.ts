import type { Job } from "@/types/job";
import type { CvTemplate, CvValueSuggestion, CvVariable } from "@/types/cv-template";
import { getApplicantContext, type ApplicantContext } from "@/features/profile/context";
import { defaultValue, extractVariableNames, findOptionsInPosting } from "@/features/cv-template/template";
import { MissingApiKeyError, getSupportModel, requestStructured } from "./client";
import { DECISION_THRESHOLDS, choiceAnswer, requestDecisions, stableHash, type DecisionQuestion } from "./decisions";
import { isSkillListVariable } from "@/features/cv-template/defaults";
import { filterKeywordList } from "@/features/keywords/filter";
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
- A job title / position value is the bare role name: no bracketed asides like (m/w/d),
  (f/m/d) or (Remote), no seniority level (Senior, Middle, Junior, Sr., Staff, Principal),
  no team, location or contract qualifiers. "Senior Backend Engineer (m/f/d)" -> "Backend Engineer".
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
 * Picks every placeholder's value for `job`. A `choice` placeholder with ≥2 variants is a pick
 * from a fixed list, so all of them go to one Decisions request (`chooseWithDecisions`); the
 * rest (`free`, or a `choice` without variants) are written by one Responses call on the
 * support tier, skipped when there are none. Both run in parallel. A pick below
 * `DECISION_THRESHOLDS.cvVariableChoice`, or a `choice` answer that doesn't match a variant,
 * falls back to the offline heuristic instead of leaking an invented variant into the PDF, and a
 * skill list like {{keywords}} loses any company/location/generic-word junk.
 */
export async function suggestCvValues(job: Job, template: CvTemplate): Promise<CvValueSuggestion[]> {
  const usedNames = new Set(extractVariableNames(template.content));
  const variables = template.variables.filter((v) => usedNames.has(v.name));
  if (variables.length === 0) return [];

  const context = await getApplicantContext();
  const choices = variables.filter((v) => v.mode === "choice" && v.options.length >= 2);
  // A single-variant `choice` has nothing to decide: the offline default is that variant.
  const written = variables.filter((v) => !(v.mode === "choice" && v.options.length > 0));
  const [picked, generated] = await Promise.all([
    choices.length > 0 ? chooseWithDecisions(job, template, choices, context) : new Map<string, CvValueSuggestion>(),
    written.length > 0 ? suggestWithResponses(job, template, written, context) : new Map<string, CvValueSuggestion>(),
  ]);

  return variables.map(
    (variable) => picked.get(variable.name) ?? generated.get(variable.name) ?? { name: variable.name, value: defaultValue(variable, job), reason: "" },
  );
}

const CHOICE_POLICY = `You adapt an applicant's CV template to one specific job posting: for each {{placeholder}}
pick the variant that makes this CV the closest honest match for the posting (its title, its location,
its main technology, the vocabulary it uses). Follow the applicant's own instruction for the placeholder.
Variants that literally occur in the posting are a strong hint, not an order: the role's actual focus
matters more than a passing mention. Never pick a variant that claims a skill, technology or experience
the applicant's CV text / Personal Legend doesn't support, unless the instruction explicitly asks for it.`;

/**
 * One Decisions `choice` per placeholder. Variants are labelled `o1`, `o2`, … with the full text as
 * the description: they can be long and multi-line, which doesn't make a usable choice value. The
 * applicant's data comes before the posting so the prefix is cached across postings. Decisions
 * gives no text, so the reason is just the confidence. If the call fails, the Responses call
 * picks these too.
 */
async function chooseWithDecisions(
  job: Job,
  template: CvTemplate,
  variables: CvVariable[],
  context: ApplicantContext,
): Promise<Map<string, CvValueSuggestion>> {
  const label = (j: number) => `o${j + 1}`;
  const questions = variables.map((v, i): DecisionQuestion => {
    const found = findOptionsInPosting(v.options, job).map((option) => `${label(v.options.indexOf(option))} ("${option}")`);
    return {
      type: "choice",
      name: `v${i}`,
      instructions: [
        `CV placeholder {{${v.name}}}. Which variant should fill it for this posting?`,
        v.description.trim() ? `The applicant's instruction for it: ${v.description.trim()}` : "",
        found.length > 0 ? `Variants found verbatim in the posting, most frequent first: ${found.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      choices: v.options.map((option, j) => ({ value: label(j), description: option })),
    };
  });

  try {
    const answers = await requestDecisions({
      input: [
        { role: "developer", content: CHOICE_POLICY },
        {
          role: "user",
          content: [
            {
              type: "input_json",
              data: {
                applicant: {
                  cvText: context.cvText.slice(0, 12_000),
                  personalLegend: context.personalLegend.slice(0, 8_000),
                  city: context.profile.city,
                  country: context.profile.country,
                },
              },
            },
            { type: "input_json", data: { job: jobPayload(job) } },
          ],
        },
      ],
      promptCacheKey: `filler-cv-values-${stableHash(context.cvText + context.personalLegend)}`,
      questions,
    });
    const picked = new Map<string, CvValueSuggestion>();
    variables.forEach((v, i) => {
      const answer = choiceAnswer(answers, `v${i}`);
      const index = answer ? v.options.findIndex((_, j) => label(j) === answer.choice) : -1;
      if (!answer || index < 0 || answer.confidence < DECISION_THRESHOLDS.cvVariableChoice) return;
      picked.set(v.name, { name: v.name, value: v.options[index], reason: `AI pick, ${Math.round(answer.confidence * 100)}% sure` });
    });
    return picked;
  } catch (err) {
    if (err instanceof MissingApiKeyError) throw err;
    console.warn("[Filler] Decisions API failed, picking CV variants via Responses:", err);
    return suggestWithResponses(job, template, variables, context);
  }
}

function jobPayload(job: Job) {
  return {
    position: job.position,
    company: job.company,
    location: job.location,
    techStack: job.techStack,
    requirements: job.requirements,
    responsibilities: job.responsibilities,
    description: job.description.slice(0, 8_000),
  };
}

/** One Responses call for `variables`; only the usable answers come back (a `choice` that doesn't match a variant is dropped). */
async function suggestWithResponses(
  job: Job,
  template: CvTemplate,
  variables: CvVariable[],
  context: ApplicantContext,
): Promise<Map<string, CvValueSuggestion>> {
  const payload = {
    variables: variables.map((v) => ({
      name: v.name,
      mode: v.mode,
      description: v.description,
      options: v.options,
      foundInPosting: findOptionsInPosting(v.options, job),
    })),
    template: template.content.slice(0, 12_000),
    job: jobPayload(job),
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

  const suggestions = new Map<string, CvValueSuggestion>();
  for (const variable of variables) {
    const answer = result.values.find((v) => v.name === variable.name);
    if (!answer) continue;
    if (variable.mode === "choice" && variable.options.length > 0) {
      const snapped = snapToOption(answer.value, variable);
      if (snapped) suggestions.set(variable.name, { name: variable.name, value: snapped, reason: stripEmDashes(answer.reason) });
      continue;
    }
    const value = stripEmDashes(answer.value);
    suggestions.set(variable.name, {
      name: variable.name,
      value: isSkillListVariable(variable.name) ? filterKeywordList(value, job) : value,
      reason: stripEmDashes(answer.reason),
    });
  }
  return suggestions;
}
