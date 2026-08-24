import { detectSemanticField } from "./field-detector";

const FILLABLE_SELECTOR = 'input, textarea, [contenteditable="true"]';
const EXCLUDED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"]);

const MIN_QUESTION_WORDS = 4;

export interface CustomQuestion {
  id: string;
  question: string;
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

/**
 * Detects free-text fields the semantic autofill engine (field-detector.ts)
 * doesn't recognize as a known profile field, but whose label reads like an
 * actual application question (spec_2 item 5) — e.g. "Why do you want to
 * work here?" — rather than an unmatched but ordinary field. Read-only: no
 * DOM writes, since the answer is inserted by drag-and-drop like every other
 * value in this app, not by targeting the element found here.
 */
export function detectCustomQuestions(): CustomQuestion[] {
  const elements = Array.from(document.querySelectorAll(FILLABLE_SELECTOR)).filter(isFillable);

  const questions: CustomQuestion[] = [];
  elements.forEach((el, index) => {
    if (detectSemanticField(el)) return;
    const signal = questionSignal(el);
    if (!isQuestionShaped(signal)) return;
    questions.push({ id: `question-${index}`, question: signal.trim() });
  });

  return questions;
}
