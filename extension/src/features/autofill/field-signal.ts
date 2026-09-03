/**
 * "What is this field asking?" — the single place that turns a fillable
 * element into a human-readable prompt string. Shared by the automatic
 * question scan (`custom-questions.ts`), the manual element picker
 * (`pick-questions.ts`) and the locator's text fallback
 * (`element-locator.ts`) so all three agree on what a field's question is.
 *
 * Order of preference mirrors how a sighted user reads a form: an
 * explicit `<label>`, then ARIA, then — ahead of a generic "type here"
 * placeholder — the nearest visible text sitting just before the field,
 * which is how many custom-styled forms (the ones the picker exists for)
 * label their inputs, with a plain `<p>`/`<div>` rather than a `<label>`.
 * A specific placeholder ("Why this company?") still wins over no
 * preceding text.
 */

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Drops a leading list number ("1." / "2)") and a trailing required-marker "*". */
function tidy(text: string): string {
  return collapse(text)
    .replace(/^\d{1,2}[.)]?\s+/, "")
    .replace(/\s*\*+\s*$/, "")
    .trim();
}

/**
 * Placeholders that carry no question — just an instruction to start
 * typing. Common on the custom-built forms the picker targets, where the
 * real question sits in a sibling `<p>` above the field.
 */
const GENERIC_PLACEHOLDER_RE = /^(type|enter|write|your answer|answer here|start typing|e\.?g\.?\b)/i;

function fromLabelElement(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const forLabel = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel?.textContent && collapse(forLabel.textContent)) return collapse(forLabel.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent && collapse(wrapping.textContent)) return collapse(wrapping.textContent);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = collapse(
      labelledBy
        .split(/\s+/)
        .map((refId) => doc.getElementById(refId)?.textContent ?? "")
        .join(" "),
    );
    if (text) return text;
  }
  return "";
}

/**
 * Walks up from the field and, at each ancestor up to `container`, looks at
 * the text of the immediately preceding sibling — the visual "label above
 * the input" pattern. Stops at `container` so a pick of one question card
 * never borrows the text of the card before it.
 */
function fromPrecedingText(el: HTMLElement, container: HTMLElement | null): string {
  let node: HTMLElement | null = el;
  const boundary = container ?? el.ownerDocument.body;
  for (let depth = 0; node && node !== boundary && depth < 5; depth++, node = node.parentElement) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling instanceof HTMLElement && !sibling.matches("input, textarea, select, script, style")) {
        const text = tidy(sibling.textContent ?? "");
        if (text.split(" ").length >= 2) return text;
      }
      sibling = sibling.previousElementSibling;
    }
  }
  return "";
}

/**
 * The question a field is asking, or `""` if nothing readable is attached.
 * `container`, when given, bounds the "nearest preceding text" fallback so
 * it can't reach outside the block the user picked.
 */
export function fieldQuestionText(el: HTMLElement, container: HTMLElement | null = null): string {
  const label = fromLabelElement(el).trim();
  if (label) return tidy(label);

  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;

  // Preceding text beats the placeholder when the placeholder is a generic
  // "type here" prompt or the preceding text already reads like a question.
  const preceding = fromPrecedingText(el, container);
  const placeholder = el.getAttribute("placeholder")?.trim() ?? "";
  if (preceding && (isQuestionShaped(preceding) || !placeholder || GENERIC_PLACEHOLDER_RE.test(placeholder))) {
    return preceding;
  }
  return placeholder || preceding || "";
}

/** A prompt reads like a real question if it has a "?" or is more than a two-word field name. */
export function isQuestionShaped(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.includes("?")) return true;
  return trimmed.split(/\s+/).length >= 3;
}
