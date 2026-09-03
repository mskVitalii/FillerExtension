import { queryFillableDeep } from "./engine";
import { fillElement } from "./native-setter";
import { detectSemanticField } from "./field-detector";
import { fieldQuestionText, isQuestionShaped } from "./field-signal";
import { buildLocator, resolveLocator, type ElementLocator } from "./element-locator";

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
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

/** What the AI decompose pass (`features/openai/decompose-block.ts`) gets per field when the DOM signal was weak. */
export interface FieldDescriptor {
  index: number;
  tag: string;
  type: string;
  name: string;
  placeholder: string;
  /** Whatever nearby text the deterministic pass could find — may be empty or noisy. */
  nearbyText: string;
  /** Choice labels for a radio-group / `<select>` — a multiple-choice question. */
  options?: string[];
}

export interface PickedField {
  locator: ElementLocator;
  /** Deterministic question text; `""` when nothing readable was attached and the AI pass should fill it in. */
  question: string;
  /** True when `question` came from a real label/aria/placeholder rather than a guess. */
  confident: boolean;
  descriptor: FieldDescriptor;
  /** Present for radio-groups / `<select>` — the AI answer must be exactly one of these. */
  options?: string[];
}

export interface DecomposeResult {
  picked: PickedField[];
  /** The picked block's visible text, for the AI decompose fallback. */
  blockText: string;
  /** Fields in the pick the semantic engine already knows (email, phone, LinkedIn…) — run Autofill, don't ask. */
  semanticCount: number;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

/** Fillable free-text fields inside `container` (piercing shadow roots), or the container itself if it is one. */
export function fillableFieldsIn(container: HTMLElement): HTMLElement[] {
  const fields = queryFillableDeep(FILLABLE_SELECTOR, container).filter(isFillable);
  if (fields.length === 0 && container.matches(FILLABLE_SELECTOR) && isFillable(container)) {
    return [container];
  }
  return fields;
}

// --- Radio groups --------------------------------------------------------

/** Visible text of one radio option. */
export function radioOptionLabel(input: HTMLInputElement): string {
  const root = input.getRootNode() as Document | ShadowRoot;
  if (input.id) {
    const forLabel = root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (forLabel?.textContent && collapse(forLabel.textContent)) return collapse(forLabel.textContent);
  }
  const wrapping = input.closest("label");
  if (wrapping?.textContent && collapse(wrapping.textContent)) return collapse(wrapping.textContent);
  const aria = input.getAttribute("aria-label");
  if (aria && collapse(aria)) return collapse(aria);
  const sibling = input.nextElementSibling;
  if (sibling?.textContent && collapse(sibling.textContent)) return collapse(sibling.textContent);
  return input.value || "";
}

/** The `groupEl` child that (transitively) contains `node`, or null. */
function topLevelChild(groupEl: HTMLElement, node: Element): Element | null {
  let n: Element | null = node;
  while (n && n.parentElement && n.parentElement !== groupEl) n = n.parentElement;
  return n && n.parentElement === groupEl ? n : null;
}

/** Smallest `<fieldset>` / `[role=radiogroup]` / common ancestor wrapping every radio in the group. */
function groupContainerOf(radios: HTMLInputElement[]): HTMLElement {
  const first = radios[0];
  const fieldset = first.closest("fieldset");
  if (fieldset instanceof HTMLElement && radios.every((r) => fieldset.contains(r))) return fieldset;
  const radiogroup = first.closest('[role="radiogroup"]');
  if (radiogroup instanceof HTMLElement && radios.every((r) => radiogroup.contains(r))) return radiogroup;
  let ancestor: HTMLElement | null = first.parentElement;
  while (ancestor && !radios.every((r) => ancestor!.contains(r))) ancestor = ancestor.parentElement;
  return ancestor ?? first;
}

/**
 * The question a radio-group asks: every heading / label / legend /
 * paragraph inside the group container that is *not* part of an option row
 * (Ashby, Greenhouse, Lever all put the prompt in a `<legend>` or a
 * `.question-title` label and the description in sibling `<p>`s).
 */
function radioGroupQuestion(groupEl: HTMLElement, radios: HTMLInputElement[], container: HTMLElement): string {
  const optionRows = new Set<Element>();
  for (const r of radios) {
    const row = topLevelChild(groupEl, r);
    if (row) optionRows.add(row);
  }
  const parts: string[] = [];
  for (const el of groupEl.querySelectorAll("legend, label, h1, h2, h3, h4, h5, h6, p")) {
    if ([...optionRows].some((row) => row.contains(el))) continue;
    const text = collapse(el.textContent ?? "");
    if (text && !parts.some((p) => p.includes(text))) parts.push(text);
  }
  return collapse(parts.join(" — ")).slice(0, 500) || fieldQuestionText(groupEl, container);
}

/** Radio groups inside `container`, grouped by `name` (falling back to the enclosing fieldset). */
function radioGroupsIn(container: HTMLElement): { groupEl: HTMLElement; radios: HTMLInputElement[] }[] {
  const radios = queryFillableDeep('input[type="radio"]', container).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && !el.disabled,
  );
  const byKey = new Map<string, HTMLInputElement[]>();
  const anonKeys = new WeakMap<Element, string>();
  let anon = 0;
  for (const r of radios) {
    let key = r.name;
    if (!key) {
      const scope = r.closest("fieldset") ?? container;
      key = anonKeys.get(scope) ?? `anon-${anon++}`;
      anonKeys.set(scope, key);
    }
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  return [...byKey.values()]
    .filter((group) => group.length >= 2)
    .map((group) => ({ groupEl: groupContainerOf(group), radios: group }));
}

// --- Decompose ---------------------------------------------------------

/**
 * Breaks the element the user picked in the visual picker into one entry
 * per question — free-text fields *and* radio groups. Deterministic first
 * (label / legend / aria / placeholder / nearest text); the caller runs
 * the AI fallback (`decompose-block.ts`) only for entries where `confident`
 * came back false.
 */
export function decomposeContainer(container: HTMLElement): DecomposeResult {
  const picked: PickedField[] = [];
  let semanticCount = 0;

  for (const el of fillableFieldsIn(container)) {
    // A field the autofill engine already recognises (email, phone,
    // LinkedIn, country…) should just be filled from the profile, never
    // turned into an AI question.
    if (detectSemanticField(el)) {
      semanticCount++;
      continue;
    }
    const question = fieldQuestionText(el, container).slice(0, 400);
    const input = el as HTMLInputElement;
    const options =
      el instanceof HTMLSelectElement
        ? Array.from(el.options)
            .map((o) => collapse(o.textContent ?? ""))
            .filter(Boolean)
        : undefined;
    picked.push({
      locator: buildLocator(el, question),
      question,
      confident: isQuestionShaped(question),
      options,
      descriptor: {
        index: picked.length,
        tag: el.tagName.toLowerCase(),
        type: input.type || "",
        name: el.getAttribute("name") || "",
        placeholder: el.getAttribute("placeholder") || "",
        nearbyText: question.slice(0, 300),
        options,
      },
    });
  }

  for (const { groupEl, radios } of radioGroupsIn(container)) {
    const question = radioGroupQuestion(groupEl, radios, container);
    const options = radios.map(radioOptionLabel).filter(Boolean);
    picked.push({
      locator: buildLocator(groupEl, question),
      question,
      confident: isQuestionShaped(question) && options.length > 0,
      options,
      descriptor: {
        index: picked.length,
        tag: "radiogroup",
        type: "radio",
        name: radios[0]?.name ?? "",
        placeholder: "",
        nearbyText: question.slice(0, 300),
        options,
      },
    });
  }

  return { picked, blockText: (container.innerText || "").slice(0, 6000), semanticCount };
}

// --- Fill -------------------------------------------------------------

function isEmptyField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.trim() === "";
  return (el.textContent ?? "").trim() === "";
}

/** Radios belonging to the group `el` represents (a fieldset/container, or one radio of the group). */
function radiosForGroup(el: HTMLElement): HTMLInputElement[] {
  if (el instanceof HTMLInputElement && el.type === "radio") {
    const scope = el.closest("fieldset") ?? el.ownerDocument;
    return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
      (r) => (el.name ? r.name === el.name : true) && !r.disabled,
    );
  }
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter((r) => !r.disabled);
}

function selectRadioOption(radios: HTMLInputElement[], answer: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = norm(answer);
  const target =
    radios.find((r) => norm(radioOptionLabel(r)) === a) ||
    radios.find((r) => {
      const label = norm(radioOptionLabel(r));
      return label.length > 0 && (label.includes(a) || a.includes(label));
    });
  if (!target) return false;

  target.focus?.();
  target.click();
  if (!target.checked) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(target, true);
  }
  // Fire these unconditionally — `.click()` may have set `.checked` without
  // the framework's controlled-input handler noticing.
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return target.checked;
}

/**
 * Writes AI answers into fields identified by locator (the manual-picker
 * counterpart to `fillCustomQuestionAnswers`, which matches by question
 * text). Handles radio groups (click the option whose label matches) and
 * `<select>` as well as free text. Never clobbers an answer the user
 * already gave. Returns how many were filled.
 */
export function fillAnswersByLocator(items: { locator: ElementLocator; answer: string }[]): number {
  let filled = 0;
  for (const { locator, answer } of items) {
    if (!answer) continue;
    const el = resolveLocator(locator);
    if (!el) continue;

    const radios = radiosForGroup(el);
    if (radios.length > 0) {
      if (radios.some((r) => r.checked)) continue;
      if (selectRadioOption(radios, answer)) filled++;
      continue;
    }

    if (el instanceof HTMLSelectElement) {
      if (el.value && el.selectedIndex > 0) continue;
      if (fillElement(el, answer)) filled++;
      continue;
    }

    if (!isEmptyField(el)) continue;
    if (fillElement(el, answer)) filled++;
  }
  return filled;
}
