import type { ProfileFieldKey } from "@/types/profile";
import type { FieldDecisionRequest, FieldDecisionResult, FieldSignals, OptionPickQuestion } from "@/features/autofill/ai-assist";
import { DECISION_THRESHOLDS, choiceAnswer, requestDecisions, type DecisionAnswers, type DecisionQuestion } from "./decisions";

/**
 * The Decisions-API side of the Autofill's AI pass (`features/autofill/ai-assist.ts`): which
 * option of a dropdown means the applicant's known value, and which profile field an
 * unclassified form field asks for. One `choice` question each, all in one request; answers
 * below their threshold come back as null and the field stays as the offline fill left it.
 */

/** The extra choice on every option question; never the name of a real option. */
export const NO_OPTION = "(none of these)";
export const NOT_PROFILE = "(not a profile field)";

const PROFILE_FIELDS: Record<ProfileFieldKey, string> = {
  salutation: "Salutation / title / gender as a form of address (Mr, Ms, Frau, Herr).",
  pronouns: "Preferred pronouns (she/her, he/him).",
  firstName: "The applicant's first / given name only.",
  lastName: "The applicant's last / family name only.",
  fullName: "The applicant's full name in one box.",
  email: "The applicant's e-mail address.",
  phone: "The applicant's phone / mobile number.",
  address: "Street and house number.",
  city: "City / town the applicant lives in.",
  postalCode: "Postal / ZIP code.",
  country: "Country the applicant lives in (not nationality, not where they want to work).",
  linkedin: "LinkedIn profile URL.",
  github: "GitHub profile URL.",
  website: "Personal website or portfolio URL.",
  expectedSalary: "The applicant's salary expectation as an amount (not a currency or period picker).",
};

const PROFILE_CHOICES = [
  ...(Object.entries(PROFILE_FIELDS) as [ProfileFieldKey, string][]).map(([value, description]) => ({ value, description })),
  {
    value: NOT_PROFILE,
    description:
      "Anything else: an application question, a date, a company, a job title, a free comment, or a field about somebody " +
      "else (a referrer, a reference, an emergency contact).",
  },
];

const POLICY = `You help autofill a job-application form from the applicant's saved profile.
Two kinds of questions follow, each about one field of the form and independent of the others:
- Option questions: the field must be set to a value the applicant already gave, but its options word it differently
  (another language, an official name, a region added, an amount written as a range). Pick the option that means
  the same thing — the same country, the same city, the range containing the amount. When no option does, pick
  "${NO_OPTION}"; never pick a merely similar one.
- Field questions: from what the page says about a field (label, name, placeholder…), which profile value does it ask
  for? Only the applicant's own data counts; when unsure, "${NOT_PROFILE}".
Labels may be in any language: judge by meaning.`;

function describeSignals(s: FieldSignals): string {
  const parts = [
    `label "${s.label}"`,
    `type ${s.kind}`,
    s.name && `name "${s.name}"`,
    s.id && `id "${s.id}"`,
    s.placeholder && `placeholder "${s.placeholder}"`,
    s.ariaLabel && `aria-label "${s.ariaLabel}"`,
    s.autocomplete && `autocomplete "${s.autocomplete}"`,
    s.other?.length && `nearby text ${s.other.map((t) => `"${t}"`).join(", ")}`,
    s.options?.length && `options ${s.options.map((t) => `"${t}"`).join(", ")}`,
  ];
  return parts.filter(Boolean).join("; ");
}

function optionQuestion(q: OptionPickQuestion): DecisionQuestion {
  return {
    type: "choice",
    name: q.id,
    instructions: `Form field labelled "${q.label}" (the applicant's ${q.field}). The applicant's value: "${q.value}". Which option is that value?`,
    choices: [...new Set(q.options)].filter((o) => o !== NO_OPTION).map((value) => ({ value })).concat({ value: NO_OPTION }),
  };
}

export function fieldDecisionQuestions(request: FieldDecisionRequest): DecisionQuestion[] {
  return [
    ...request.optionPicks.filter((q) => q.options.length > 0).map(optionQuestion),
    ...request.fieldKinds.map(
      (q): DecisionQuestion => ({
        type: "choice",
        name: q.id,
        instructions: `A form field with ${describeSignals(q.signals)}. Which of the applicant's profile values does it ask for?`,
        choices: PROFILE_CHOICES,
      }),
    ),
  ];
}

/** Each question's answer, null below its threshold or when the model declined. */
export function readFieldDecisions(request: FieldDecisionRequest, answers: DecisionAnswers): FieldDecisionResult {
  return {
    optionPicks: request.optionPicks
      .filter((q) => answers.has(q.id))
      .map((q) => {
        const answer = choiceAnswer(answers, q.id);
        const ok = answer && answer.confidence >= DECISION_THRESHOLDS.optionMatch && q.options.includes(answer.choice);
        return { id: q.id, choice: ok ? answer.choice : null };
      }),
    fieldKinds: request.fieldKinds
      .filter((q) => answers.has(q.id))
      .map((q) => {
        const answer = choiceAnswer(answers, q.id);
        const ok = answer && answer.confidence >= DECISION_THRESHOLDS.profileField && answer.choice in PROFILE_FIELDS;
        return { id: q.id, field: ok ? (answer.choice as ProfileFieldKey) : null };
      }),
  };
}

export async function decideFields(request: FieldDecisionRequest): Promise<FieldDecisionResult> {
  const questions = fieldDecisionQuestions(request);
  if (questions.length === 0) return { optionPicks: [], fieldKinds: [] };
  const answers = await requestDecisions({ input: POLICY, questions, promptCacheKey: "filler-field-decisions" });
  return readFieldDecisions(request, answers);
}
