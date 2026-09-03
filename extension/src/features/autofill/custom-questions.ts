import { detectSemanticField } from "./field-detector";
import { queryFillableDeep } from "./engine";
import { fillElement } from "./native-setter";
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

const MIN_QUESTION_WORDS = 4;

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

function labelForElement(el: HTMLElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent;
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) return wrappingLabel.textContent;

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => document.getElementById(refId)?.textContent ?? "")
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

/** A signal counts as "question-shaped" if it reads like a real prompt, not a short field name. */
function isQuestionShaped(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("?")) return true;
  return trimmed.split(/\s+/).length >= MIN_QUESTION_WORDS;
}

function questionSignal(el: HTMLElement): string {
  return (
    labelForElement(el).trim() ||
    el.getAttribute("aria-label")?.trim() ||
    el.getAttribute("placeholder")?.trim() ||
    ""
  );
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
 * question *text* is the field's own label/aria/placeholder, so re-scanning
 * later and matching by that text finds the same element again (used by
 * `fillCustomQuestionAnswers`).
 */
function scanQuestionFields(): QuestionField[] {
  const elements = queryFillableDeep(FILLABLE_SELECTOR).filter(isFillable);

  const fields: QuestionField[] = [];
  for (const el of elements) {
    if (detectSemanticField(el)) continue;
    const signal = questionSignal(el);
    if (!isQuestionShaped(signal)) continue;
    fields.push({ question: signal.trim(), el });
  }
  return fields;
}

export function detectCustomQuestions(): CustomQuestion[] {
  return scanQuestionFields().map((field, index) => ({
    id: `question-${index}`,
    question: field.question,
  }));
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
