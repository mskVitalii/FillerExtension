import { fieldQuestionText } from "./field-signal";
import { queryFillableDeep } from "./dom-query";

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
  /**
   * Chrome frame id of the document the element lives in, stamped by the
   * background (the content script can't learn its own frame id). Lets the
   * router send the write-back to that one frame instead of every frame,
   * where a loose text-hint match could hit a look-alike field in another
   * iframe. Absent → broadcast, as before.
   */
  frameId?: number;
  /**
   * Attributes a re-render keeps even when it swaps the DOM node: a React
   * remount drops `data-filler-loc`, and a structural change breaks the CSS
   * path, but `name`/`autocomplete`/the label usually survive. Optional so
   * locators cached before this existed still resolve.
   */
  key?: FieldKey;
}

/** Re-render-proof description of one field or radio/checkbox group — see `describeField`. */
export interface FieldKey {
  /** `input:text`, `textarea`, `select`, `group:radio`, … — a candidate must match it exactly. */
  kind: string;
  id?: string;
  name?: string;
  autocomplete?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Position among same-kind fields in the document — the last resort when nothing else identifies it. */
  ordinal: number;
  /** How many same-kind fields there were — `ordinal` is only trusted while the form still has that many. */
  count?: number;
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
  return { tag: markElement(el), selector: cssPath(el), textHint: textHint.slice(0, 200), key: describeField(el) };
}

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
const GROUP_INPUT_SELECTOR = 'input[type="radio"], input[type="checkbox"]';

/** The single radio/checkbox `name` shared by every option inside a group container, if any. */
function groupInputs(el: HTMLElement): HTMLInputElement[] {
  if (el.matches(FILLABLE_SELECTOR)) return [];
  return Array.from(el.querySelectorAll<HTMLInputElement>(GROUP_INPUT_SELECTOR));
}

function fieldKind(el: HTMLElement): string {
  const inputs = groupInputs(el);
  if (inputs.length > 0) return `group:${inputs[0].type}`;
  if (el.querySelector('button[aria-pressed], [role="button"][aria-pressed]')) return "group:button";
  const tag = el.tagName.toLowerCase();
  if (el instanceof HTMLInputElement) return `input:${el.type}`;
  if (tag === "input" || tag === "textarea" || tag === "select") return tag;
  return el.getAttribute("role") === "combobox" ? "combobox" : "editable";
}

/** React's `useId` (`:r3:`, `«r3»`) and most generated ids change on remount — not worth trusting. */
const GENERATED_ID_RE = /^[:«]|^(react-select|mui|radix|headlessui)-/i;

function sameKindFields(kind: string): HTMLElement[] {
  if (kind.startsWith("group:")) return [];
  return queryFillableDeep(FILLABLE_SELECTOR).filter((el) => fieldKind(el) === kind);
}

/**
 * What identifies `el` independently of the node itself — so after React
 * replaces it (same form, new node) `findByKey` can pick the replacement.
 */
export function describeField(el: HTMLElement): FieldKey {
  const kind = fieldKind(el);
  const attr = (name: string) => el.getAttribute(name)?.trim() || undefined;
  if (kind.startsWith("group:")) {
    const names = new Set(groupInputs(el).map((i) => i.name).filter(Boolean));
    return {
      kind,
      id: el.id && !GENERATED_ID_RE.test(el.id) ? el.id : undefined,
      name: names.size === 1 ? [...names][0] : undefined,
      ariaLabel: attr("aria-label"),
      ordinal: 0,
    };
  }
  const siblings = sameKindFields(kind);
  return {
    kind,
    id: el.id && !GENERATED_ID_RE.test(el.id) ? el.id : undefined,
    name: attr("name"),
    autocomplete: attr("autocomplete"),
    ariaLabel: attr("aria-label"),
    placeholder: attr("placeholder"),
    ordinal: Math.max(0, siblings.indexOf(el)),
    count: siblings.length,
  };
}

function lowestCommonAncestor(nodes: Element[]): HTMLElement | null {
  let ancestor: HTMLElement | null = nodes[0]?.parentElement ?? null;
  while (ancestor && !nodes.every((n) => ancestor!.contains(n))) ancestor = ancestor.parentElement;
  return ancestor;
}

/**
 * Finds the live element a `FieldKey` describes. Every match is checked
 * against `kind` first, so a recycled `name` on a different control (a
 * hidden `<input name="email">` mirror beside the visible one) never wins.
 * Attributes are tried most specific first; an ambiguous one (two visible
 * fields sharing a `name`) is skipped rather than guessed.
 */
export function findByKey(key: FieldKey): HTMLElement | null {
  if (key.kind.startsWith("group:")) {
    if (key.id) {
      const byId = document.getElementById(key.id);
      if (byId && fieldKind(byId) === key.kind) return byId;
    }
    if (key.name) {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(key.name)}"]`),
      ).filter((i) => i.matches(GROUP_INPUT_SELECTOR));
      const fieldset = inputs[0]?.closest('fieldset, [role="radiogroup"], [role="group"]');
      if (fieldset instanceof HTMLElement && inputs.every((i) => fieldset.contains(i))) return fieldset;
      if (inputs.length > 1) return lowestCommonAncestor(inputs);
    }
    return null;
  }

  const candidates = sameKindFields(key.kind);
  const unique = (match: (el: HTMLElement) => boolean): HTMLElement | null => {
    const hits = candidates.filter(match);
    return hits.length === 1 ? hits[0] : null;
  };
  if (key.id) {
    const byId = unique((el) => el.id === key.id);
    if (byId) return byId;
  }
  for (const attr of ["name", "autocomplete", "aria-label", "placeholder"] as const) {
    const wanted = attr === "aria-label" ? key.ariaLabel : key[attr];
    if (!wanted) continue;
    const hit = unique((el) => el.getAttribute(attr)?.trim() === wanted);
    if (hit) return hit;
  }
  return null;
}

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

/** Toggle-button group containers anywhere in the document (Ashby/Greenhouse-style Yes/No widgets — see `pick-questions.ts`). */
function buttonGroupContainers(): HTMLElement[] {
  const parents = new Set<HTMLElement>();
  for (const btn of document.querySelectorAll<HTMLElement>('button[aria-pressed], [role="button"][aria-pressed]')) {
    if (btn.parentElement) parents.add(btn.parentElement);
  }
  return [...parents].filter(
    (el) => el.querySelectorAll('button[aria-pressed], [role="button"][aria-pressed]').length >= 2,
  );
}

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
 * Resolves a locator back to a live element: tag attr → stable key
 * (id/name/autocomplete/aria-label/placeholder) → CSS path → text hint →
 * same-kind position. The text-hint pass is what saves a fill after the form re-rendered
 * and dropped the `data-filler-loc` attribute — React ATS forms (Ashby,
 * Greenhouse) remount the whole form on a new session id, so this runs
 * often. It matches radio-group / `<select>` containers by their prompt as
 * well as plain fields by their label.
 */
export function resolveLocator(loc: ElementLocator): HTMLElement | null {
  const byTag = deepQuerySelector(`[${LOC_ATTR}="${CSS.escape(loc.tag)}"]`);
  if (byTag) return byTag;

  if (loc.key) {
    const byKey = findByKey(loc.key);
    if (byKey) return byKey;
  }

  if (loc.selector) {
    try {
      const bySelector = document.querySelector(loc.selector);
      // After a structural re-render the old nth-of-type path can land on a
      // *different* control — only trust it when it's still the same kind.
      if (bySelector instanceof HTMLElement && (!loc.key || fieldKind(bySelector) === loc.key.kind)) {
        return bySelector;
      }
    } catch {
      // A generated path can be invalid on an exotic DOM — fall through to the text hint.
    }
  }

  if (loc.textHint) {
    const hint = norm(loc.textHint);
    for (const box of document.querySelectorAll<HTMLElement>('fieldset, [role="radiogroup"]')) {
      if (loose(hint, groupLabelText(box))) return box;
    }
    for (const box of buttonGroupContainers()) {
      // The prompt usually lives outside a toggle-button group (a sibling
      // <label>, not an internal <legend>) — fieldQuestionText's
      // preceding-sibling climb finds it, unlike groupLabelText above.
      if (loose(hint, norm(fieldQuestionText(box)))) return box;
    }
    for (const el of queryFillableDeep(FILLABLE_SELECTOR)) {
      if (loose(hint, norm(fieldQuestionText(el)))) return el;
    }
  }

  // Nothing about the field survived but its position: the n-th field of the
  // same kind. Only for plain fields — a group's position is too ambiguous.
  if (loc.key && !loc.key.kind.startsWith("group:")) {
    const fields = sameKindFields(loc.key.kind);
    if (fields.length === loc.key.count) return fields[loc.key.ordinal] ?? null;
  }
  return null;
}
