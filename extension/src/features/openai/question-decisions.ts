import type { Job } from "@/types/job";
import type { ApplicantContext } from "@/features/profile/context";
import { isNewsletterLike, type PageCheckbox } from "@/features/autofill/checkboxes";
import { todayISO } from "@/lib/date-format";
import type { CheckboxCategory, CheckboxDecision } from "./decide-checkboxes";
import {
  DECISION_THRESHOLDS,
  choiceAnswer,
  predicateProbability,
  stableHash,
  type DecisionAnswers,
  type DecisionInput,
  type DecisionQuestion,
} from "./decisions";

/**
 * The Decisions-API half of answering an application form: consent checkboxes, questions with
 * fixed options, and the "is there enough data to answer this" gate in front of free-text
 * generation. Each builder names its questions by position (`cb3_check`, `q2`, `q2_o1`,
 * `facts4`) and each reader maps the answers back by those names.
 */

/** A question the Decisions API can answer by picking among its options. */
export interface OptionQuestion {
  question: string;
  options?: string[];
  multi?: boolean;
}

export interface DecidedAnswer {
  answer: string;
  /** False when the answer must come from the user (data missing, or the model unsure). */
  sufficientInfo: boolean;
  /** 0..1 — how sure the pick is (a choice's confidence; for select-all, the least certain option). */
  confidence: number;
}

const POLICY = `You evaluate a job-application form on behalf of the applicant whose data is in the JSON below.
The applicant has already chosen to submit this application.
- Ground every judgement ONLY in the applicant's data (profile, cvText, personalLegend, languageLevels,
  customFields, faq, coverLetter) and the job posting. Never assume experience, skills or facts that
  aren't there.
- For language proficiency, "languageLevels" (CEFR levels the applicant set themselves) is authoritative.
- Consent checkboxes. TICK: privacy policy / data protection / GDPR / Datenschutz consent; terms &
  conditions / AGB; confirming the information is accurate; processing the data for THIS hiring
  process; a talent pool ONLY when the form marks it required; ordinary eligibility declarations (at
  least 18, legally allowed to work in the country, no undisclosed conflicts) unless the applicant's
  data says otherwise. DO NOT TICK: newsletters, marketing e-mails, career news, event invitations,
  job alerts, sharing data with third parties or partners, an optional talent pool, anything that
  goes beyond this one application. A newsletter / marketing / job-alert opt-in is never ticked,
  even when the form marks it required. An ambiguous checkbox that isn't required stays unticked.
  Labels may be in any language: judge by meaning.
- Questions with fixed options: the applicant's truthful answer. When the needed fact is absent from
  the data, a neutral option ("prefer not to say") or the one that commits the applicant least. A
  newsletter / marketing / job-alert subscription question always gets the option that declines it.`;

/**
 * The shared evidence for every Decisions question about this form: a fixed policy, then the
 * applicant's data with the parts that change least first, so repeated calls share a cacheable
 * prefix (≥1024 tokens with a real CV). `todayISO` is last because it changes daily.
 */
export function applicantDecisionInput(
  context: ApplicantContext,
  coverLetter: string,
  job: Job,
  postingLanguage?: string,
): { input: DecisionInput; promptCacheKey: string } {
  const data = {
    profile: context.profile,
    languageLevels: context.languageLevels,
    customFields: context.customFields,
    faq: context.faq.filter((f) => f.answer.trim()),
    cvText: context.cvText,
    personalLegend: context.personalLegend,
    job,
    coverLetter,
    postingLanguage: postingLanguage || null,
    todayISO: todayISO(),
  };
  return {
    input: [
      { role: "developer", content: POLICY },
      { role: "user", content: [{ type: "input_json", data }] },
    ],
    promptCacheKey: `filler-applicant-${stableHash(context.cvText + context.personalLegend)}`,
  };
}

/** Distinct, non-empty options, in page order. */
function cleanOptions(options: string[] | undefined): string[] {
  return [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))];
}

/** Whether a question is answered by picking options (≥2 of them), rather than by writing text. */
export function hasChoiceOptions(q: OptionQuestion): boolean {
  return cleanOptions(q.options).length >= 2;
}

// ── checkboxes ────────────────────────────────────────────────────────────

const CATEGORY_CHOICES: { value: CheckboxCategory; description: string }[] = [
  { value: "required-consent", description: "Needed to submit: privacy/data-protection consent, terms, accuracy confirmation, eligibility declaration." },
  { value: "marketing", description: "Newsletter, marketing e-mail, job alerts, event invitations, sharing data with partners." },
  { value: "optional", description: "Not marketing, but not needed to submit (e.g. an optional talent pool)." },
  { value: "unclear", description: "Can't tell what ticking it means." },
];

function checkboxDescription(checkbox: PageCheckbox): string {
  return `Checkbox on the application form: "${checkbox.label}". ${checkbox.required ? "The form marks it required." : "The form does not mark it required."}`;
}

export function checkboxDecisionQuestions(checkboxes: PageCheckbox[]): DecisionQuestion[] {
  return checkboxes.flatMap((checkbox, i): DecisionQuestion[] => [
    {
      type: "predicate",
      name: `cb${i}_check`,
      instructions: `${checkboxDescription(checkbox)} Should the applicant tick it?`,
    },
    {
      type: "choice",
      name: `cb${i}_category`,
      instructions: `${checkboxDescription(checkbox)} What kind of checkbox is it?`,
      choices: CATEGORY_CHOICES,
    },
  ]);
}

/** The decision for checkbox `i`, or null when the API returned nothing usable for it. */
export function readCheckboxDecision(checkbox: PageCheckbox, i: number, answers: DecisionAnswers): CheckboxDecision | null {
  const probability = predicateProbability(answers, `cb${i}_check`);
  if (probability === null) return null;
  const category = choiceAnswer(answers, `cb${i}_category`);
  const known = category && CATEGORY_CHOICES.some((c) => c.value === category.choice);
  const resolvedCategory: CheckboxCategory =
    known && category.confidence >= DECISION_THRESHOLDS.checkboxCategory ? (category.choice as CheckboxCategory) : "unclear";
  // Same backstop as the Responses path: a newsletter opt-in is never ticked (spec_8 item 5).
  const check = probability >= DECISION_THRESHOLDS.checkboxCheck && !isNewsletterLike(checkbox.label);
  const sure = Math.round(Math.max(probability, 1 - probability) * 100);
  return {
    name: checkbox.name,
    label: checkbox.label,
    check,
    category: resolvedCategory,
    reason: `${resolvedCategory.replace("-", " ")}, ${sure}% sure`,
    confidence: Math.max(probability, 1 - probability),
  };
}

// ── option questions ──────────────────────────────────────────────────────

/** One `choice` over the options, or for select-all one `predicate` per option. Empty when the question has <2 options. */
export function optionDecisionQuestions(q: OptionQuestion, i: number): DecisionQuestion[] {
  const options = cleanOptions(q.options);
  if (options.length < 2) return [];
  if (q.multi) {
    return options.map((option, j) => ({
      type: "predicate",
      name: `q${i}_o${j}`,
      instructions: `Select-all-that-apply question on the application form: "${q.question}". Does the option "${option}" apply to the applicant, supported by the applicant's own data (not just plausible)?`,
    }));
  }
  return [
    {
      type: "choice",
      name: `q${i}`,
      instructions: `Question on the application form: "${q.question}". Which option is the applicant's answer?`,
      choices: options.map((value) => ({ value })),
    },
  ];
}

/**
 * The answer to option question `i`: the option text verbatim (select-all: joined by " | ",
 * the format the autofill engine expects). Below the confidence threshold it's a non-answer
 * for the user. Null when the API returned nothing usable.
 */
export function readOptionAnswer(q: OptionQuestion, i: number, answers: DecisionAnswers): DecidedAnswer | null {
  const options = cleanOptions(q.options);
  if (q.multi) {
    const probabilities = options.map((_, j) => predicateProbability(answers, `q${i}_o${j}`));
    if (probabilities.some((p) => p === null)) return null;
    const ps = probabilities as number[];
    const confidence = Math.min(...ps.map((p) => Math.abs(p - 0.5) * 2));
    if (ps.some((p) => Math.abs(p - 0.5) < DECISION_THRESHOLDS.multiOptionMargin)) {
      return { answer: "", sufficientInfo: false, confidence };
    }
    const picked = options.filter((_, j) => ps[j] >= DECISION_THRESHOLDS.multiOptionPick);
    return { answer: picked.join(" | "), sufficientInfo: true, confidence };
  }
  const choice = choiceAnswer(answers, `q${i}`);
  if (!choice || !options.includes(choice.choice)) return null;
  if (choice.confidence < DECISION_THRESHOLDS.optionChoice) return { answer: "", sufficientInfo: false, confidence: choice.confidence };
  return { answer: choice.choice, sufficientInfo: true, confidence: choice.confidence };
}

// ── facts gate for free-text questions ────────────────────────────────────

export interface TextQuestion {
  question: string;
  numeric?: boolean;
  dateKind?: string;
}

/**
 * Whether the applicant's data is enough to answer free-text question `i` truthfully. Only
 * factual questions can fail it: writing tasks (motivation, why us, describe a project) are
 * always answerable from the CV and Personal Legend.
 */
export function factsGateQuestion(q: TextQuestion, i: number): DecisionQuestion {
  const format = q.numeric ? " The field takes a number." : q.dateKind ? " The field takes a date." : "";
  return {
    type: "predicate",
    name: `facts${i}`,
    instructions: `Question on the application form: "${q.question}".${format}
Can it be answered truthfully from the applicant's data?
- Yes for any writing task (motivation, why this company or role, describe a project, a strength, a
  situation, tell us about yourself): those are written from the CV and Personal Legend.
- Yes for a factual question whose answer the data states or directly implies (e.g. a start date from
  a stated notice period, or today when nothing constrains it; years of experience from the CV).
- No only for a factual question (a salary figure, a notice period, a visa status, a referral, an ID,
  an address detail…) whose answer is not in the data.`,
  };
}

/** True/false from the gate; null when the API didn't answer it (then generate anyway). */
export function readFactsGate(i: number, answers: DecisionAnswers): boolean | null {
  const probability = predicateProbability(answers, `facts${i}`);
  return probability === null ? null : probability >= DECISION_THRESHOLDS.factsAvailable;
}
