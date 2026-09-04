import { detectSemanticField } from "./field-detector";
import { queryFillableDeep } from "./engine";
import { fillElement } from "./native-setter";
import { fieldQuestionText, isQuestionShaped } from "./field-signal";
import type { ElementLocator } from "./element-locator";

const FILLABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';
const EXCLUDED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
  "password",
]);

export interface CustomQuestion {
  id: string;
  question: string;
  /**
   * Present only for questions added via the visual element picker
   * (`element-picker.ts`). The automatic scan omits it — it re-scans and
   * matches by `question` text; picked fields often have no such text, so
   * their answer is written back by locator instead.
   */
  locator?: ElementLocator;
  /** Choice labels when the picked field is a radio-group / `<select>` — the answer must be one of these. */
  options?: string[];
}

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

interface QuestionField {
  question: string;
  el: HTMLElement;
}

/**
 * Free-text fields the semantic autofill engine (field-detector.ts) doesn't
 * recognize as a known profile field, but whose label reads like an actual
 * application question (spec_2 item 5) — e.g. "Why do you want to work
 * here?" — rather than an unmatched but ordinary field. Deterministic: the
 * question *text* is `field-signal.ts#fieldQuestionText` (shared with the
 * visual picker — label → aria → nearby preceding text → placeholder), so
 * re-scanning later and matching by that text finds the same element again
 * (used by `fillCustomQuestionAnswers`). Using the same richer signal here
 * (rather than a simpler label/aria/placeholder-only lookup this module used
 * to have of its own) matters concretely: a field with no real label whose
 * question lives in a sibling `<p>` above it — e.g. a custom question card
 * with nothing but a generic "Type your answer here…" placeholder — used to
 * be misdetected as *that placeholder itself* being the question, so the AI
 * was asked to answer "Type your answer here…" and correctly replied with a
 * "please provide the actual question" non-answer, which still got written
 * into the field. `fieldQuestionText`'s nearby-text climb finds the real `<p>`
 * instead; `isQuestionShaped` additionally rejects a signal that's nothing
 * but that generic placeholder text, so a field with truly no findable
 * question is skipped here rather than faked into one.
 */
function scanQuestionFields(): QuestionField[] {
  const elements = queryFillableDeep(FILLABLE_SELECTOR).filter(isFillable);

  const fields: QuestionField[] = [];
  for (const el of elements) {
    if (detectSemanticField(el)) continue;
    const question = fieldQuestionText(el).trim();
    if (!isQuestionShaped(question)) continue;
    fields.push({ question, el });
  }
  return fields;
}

export function detectCustomQuestions(): CustomQuestion[] {
  return scanQuestionFields().map((field, index) => ({
    id: `question-${index}`,
    question: field.question,
  }));
}

/**
 * The key `answerAndFillQuestions` (Side Panel) uses to store/look up one
 * question's answer. Picker-added questions must key off their `locator`,
 * not `question` text: several fields on the *same* custom-built form
 * routinely share an identical generic prompt — e.g. two "Type your answer
 * here…" textareas whose real question lives in a sibling `<p>` the
 * deterministic pass didn't attach — and text-keying would silently
 * collapse them into one answer slot, leaving one field unanswered/wrong.
 * The automatic scan has no locator and must stay text-keyed: it re-matches
 * elements by that same text on every re-scan (`fillCustomQuestionAnswers`).
 */
export function questionAnswerKey(q: Pick<CustomQuestion, "question" | "locator">): string {
  return q.locator ? `loc:${q.locator.tag}` : q.question;
}

function isEmptyField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() === "";
  return (el.textContent ?? "").trim() === "";
}

/**
 * Writes AI-generated answers back into their fields. Re-scans rather than
 * holding element references from an earlier `detectCustomQuestions` call —
 * keeps this stateless across the detect → answer → fill round-trip and
 * resilient to the form re-rendering in between. Skips any field the user
 * has already typed into (this runs automatically, so it must never clobber
 * a manual answer). Returns how many fields were filled.
 */
export function fillCustomQuestionAnswers(answers: Record<string, string>): number {
  let filled = 0;
  for (const { question, el } of scanQuestionFields()) {
    const answer = answers[question];
    if (!answer || !isEmptyField(el)) continue;
    if (fillElement(el, answer)) filled++;
  }
  return filled;
}
