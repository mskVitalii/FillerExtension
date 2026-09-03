import { fieldQuestionText } from "./field-signal";
import { queryFillableDeep } from "./engine";

/**
 * A durable-ish reference to one field the user picked, so its AI answer
 * can be written back later — after a tab switch, a panel reopen, or the
 * form re-rendering in between.
 *
 * The automatic question pass (`custom-questions.ts`) doesn't need this: it
 * re-scans and matches by the field's own question *text*. Manually picked
 * fields often have no such text (that's why they needed picking), so we
 * carry three fallbacks, tried in order of reliability.
 */
export interface ElementLocator {
  /** `data-filler-loc` value stamped on the element at pick time. Best signal, but a re-render drops it. */
  tag: string;
  /** Best-effort unique CSS path, anchored to the nearest ancestor with an `id`. Survives re-renders that keep structure. */
  selector: string;
  /** The field's question text at pick time — last-resort match against a fresh scan. */
  textHint: string;
}

const LOC_ATTR = "data-filler-loc";
let counter = 0;

/** Stamps a fresh `data-filler-loc` on the element and returns its value. */
export function markElement(el: HTMLElement): string {
  const existing = el.getAttribute(LOC_ATTR);
  if (existing) return existing;
  const id = `f${Date.now().toString(36)}-${(counter++).toString(36)}`;
  el.setAttribute(LOC_ATTR, id);
  return id;
}

/** `nth-of-type` path from `el` up to the nearest id-bearing ancestor (or a shallow cap). */
function cssPath(el: HTMLElement): string {
  const segments: string[] = [];
  let node: HTMLElement | null = el;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    if (node.id) {
      segments.unshift(`#${CSS.escape(node.id)}`);
      return segments.join(" > ");
    }
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent) {
      segments.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    const nth = sameTag.indexOf(node) + 1;
    segments.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${nth})` : tag);
  }
  return segments.join(" > ");
}

export function buildLocator(el: HTMLElement, textHint: string): ElementLocator {
  return { tag: markElement(el), selector: cssPath(el), textHint: textHint.slice(0, 200) };
}

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';

/** First element matching `selector` anywhere in the document, piercing open shadow roots. */
function deepQuerySelector(selector: string): HTMLElement | null {
  const walk = (root: ParentNode): HTMLElement | null => {
    const direct = root.querySelector(selector);
    if (direct instanceof HTMLElement) return direct;
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) {
        const found = walk(host.shadowRoot);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(document);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const loose = (a: string, b: string) => Boolean(a) && Boolean(b) && (a === b || a.startsWith(b) || b.startsWith(a));

/** The group's own prompt — first legend/label that isn't one of its option labels. */
function groupLabelText(container: HTMLElement): string {
  const optionIds = new Set(
    Array.from(container.querySelectorAll('input[type="radio"], input[type="checkbox"]'))
      .map((i) => i.id)
      .filter(Boolean),
  );
  for (const el of container.querySelectorAll("legend, label")) {
    if (el instanceof HTMLLabelElement && el.htmlFor && optionIds.has(el.htmlFor)) continue;
    const text = norm(el.textContent ?? "");
    if (text) return text;
  }
  return "";
}

/**
 * Resolves a locator back to a live element: tag attr → CSS path → text
 * hint. The text-hint pass is what saves a fill after the form re-rendered
 * and dropped the `data-filler-loc` attribute — React ATS forms (Ashby,
 * Greenhouse) remount the whole form on a new session id, so this runs
 * often. It matches radio-group / `<select>` containers by their prompt as
 * well as plain fields by their label.
 */
export function resolveLocator(loc: ElementLocator): HTMLElement | null {
  const byTag = deepQuerySelector(`[${LOC_ATTR}="${CSS.escape(loc.tag)}"]`);
  if (byTag) return byTag;

  if (loc.selector) {
    try {
      const bySelector = document.querySelector(loc.selector);
      if (bySelector instanceof HTMLElement) return bySelector;
    } catch {
      // A generated path can be invalid on an exotic DOM — fall through to the text hint.
    }
  }

  if (loc.textHint) {
    const hint = norm(loc.textHint);
    for (const box of document.querySelectorAll<HTMLElement>('fieldset, [role="radiogroup"]')) {
      if (loose(hint, groupLabelText(box))) return box;
    }
    for (const el of queryFillableDeep(FILLABLE_SELECTOR)) {
      if (loose(hint, norm(fieldQuestionText(el)))) return el;
    }
  }
  return null;
}
