import type { PageCheckbox } from "@/features/autofill/checkboxes";
import { MODEL_LUNA, requestStructured } from "./client";

export type CheckboxCategory = "required-consent" | "marketing" | "optional" | "unclear";

export interface CheckboxDecision {
  name: string;
  label: string;
  check: boolean;
  category: CheckboxCategory;
  reason: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decisions"],
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "check", "category", "reason"],
        properties: {
          index: { type: "integer" },
          check: { type: "boolean" },
          category: {
            type: "string",
            enum: ["required-consent", "marketing", "optional", "unclear"],
          },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You decide, for each checkbox on a job-application form, whether the
applicant should tick it. The applicant has already chosen to submit this
application.

TICK (check: true) — things required to submit, or that a candidate is
normally expected to accept:
- privacy policy / data protection / GDPR / Datenschutz consent
- terms & conditions / AGB / Nutzungsbedingungen
- confirming the entered information is accurate / truthful
- consent to process and store the application data for THIS hiring process
- storing the data in a talent pool ONLY when the checkbox is marked required
- eligibility self-declarations that hold for any ordinary adult applying
  for a real job (e.g. "I am at least 18 years old", "I am legally
  entitled to work in [country]", "I have no undisclosed conflicts of
  interest") — assume true unless the profile/CV explicitly states
  otherwise; a genuine job applicant submitting this form is virtually
  always eligible, and leaving a required declaration like this unticked
  blocks submission for no real reason

DO NOT TICK (check: false) — optional and promotional:
- newsletters, marketing e-mails, "career news", event invitations
- job alerts / notifications about new postings
  (e.g. "Benachrichtigungen über neue Stellenausschreibungen erhalten")
- sharing data with third parties / partner companies for marketing
- joining a talent pool / candidate database when NOT required
- anything that benefits the applicant only beyond this one application

Rules:
- "required: true" means the form marks the field mandatory — a strong
  signal to tick, unless the text is clearly marketing.
- If a checkbox is ambiguous AND not required, set check: false.
- Labels may be in any language; judge by meaning, not keywords.
- Return one decision per input item, using its "index".

category: "required-consent" (ticked, mandatory-type), "marketing" (left
off), "optional" (non-marketing but skippable, left off unless required),
"unclear" (left off). reason: one short phrase.`;

interface RawDecision {
  index: number;
  check: boolean;
  category: CheckboxCategory;
  reason: string;
}

/**
 * Classifies each collected checkbox (features/autofill/checkboxes.ts) so the
 * content script can tick the mandatory consents and leave the marketing
 * opt-ins alone. MODEL_LUNA: short judgements, run automatically on panel
 * open alongside the question answers.
 */
export async function decideCheckboxes(checkboxes: PageCheckbox[]): Promise<CheckboxDecision[]> {
  if (checkboxes.length === 0) return [];

  const userPrompt = JSON.stringify(
    checkboxes.map((checkbox, index) => ({
      index,
      label: checkbox.label,
      required: checkbox.required,
      currentlyChecked: checkbox.checked,
    })),
    null,
    2,
  );

  const result = await requestStructured<{ decisions: RawDecision[] }>({
    schemaName: "checkbox_decisions",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { decisions: RawDecision[] },
  });

  const byIndex = new Map<number, RawDecision>();
  for (const decision of result.decisions) byIndex.set(decision.index, decision);

  return checkboxes.map((checkbox, index) => {
    const decision = byIndex.get(index);
    if (decision) {
      return {
        name: checkbox.name,
        label: checkbox.label,
        check: decision.check,
        category: decision.category,
        reason: decision.reason,
      };
    }
    // The model skipped this one — fall back on the required flag.
    return {
      name: checkbox.name,
      label: checkbox.label,
      check: checkbox.required,
      category: checkbox.required ? "required-consent" : "unclear",
      reason: checkbox.required ? "Marked required by the form" : "No decision returned",
    };
  });
}
