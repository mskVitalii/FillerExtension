import { queryFillableDeep } from "./engine";
import { fillElement } from "./native-setter";
import { fillComboboxAnswer } from "./combobox";
import { detectSemanticField } from "./field-detector";
import { collapse, fieldQuestionText, isQuestionShaped, nativeFieldOptions } from "./field-signal";
import { wantsNumericValue, dateInputKind } from "./field-format";
import type { DateInputKind } from "@/lib/date-format";
import { buildLocator, resolveLocator, type ElementLocator } from "./element-locator";
import { setChecked } from "./checkboxes";

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
  /** Present for radio-groups / `<select>` / checkbox-groups — the AI answer must be (a subset of, for `multi`) these. */
  options?: string[];
  /** True for a "select all that apply" checkbox-group — the AI answer may name more than one of `options`. */
  multi?: boolean;
  /** True when the field only accepts a bare number — the AI must answer with digits only, no currency/units/prose. */
  numeric?: boolean;
  /** Present when the field is a `date`/`month`/`week`/`time`/`datetime-local` input — the answer must be in that exact format. */
  dateKind?: DateInputKind;
}

export interface DecomposeResult {
  picked: PickedField[];
  /** The picked block's visible text, for the AI decompose fallback. */
  blockText: string;
  /** Fields in the pick the semantic engine already knows (email, phone, LinkedIn…) — run Autofill, don't ask. */
  semanticCount: number;
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
  // LinkedIn Easy Apply wires each option as its own `[role="radio"]` row: the
  // <input>'s `for=` label is empty and the visible "Yes"/"No" text sits in a
  // further sibling div, two levels up — invisible to the checks above, which
  // all leave `input.value` (="on" for a radio with no explicit `value`, so
  // every option in the group would read identically). Read the whole row's
  // textContent instead — never the row's own `aria-label`, which LinkedIn
  // sets to the *group's question*, not the option, so reusing it here would
  // make every option's label the whole question again.
  const row = input.closest('[role="radio"], [role="option"]');
  if (row?.textContent && collapse(row.textContent)) return collapse(row.textContent);
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
  const radiosOf = (scope: HTMLElement) =>
    queryFillableDeep('input[type="radio"]', scope).filter(
      (el): el is HTMLInputElement => el instanceof HTMLInputElement && !el.disabled,
    );

  let radios = radiosOf(container);
  if (radios.length < 2) {
    // The user often lands on a node *inside* one option (the styled circle,
    // the label) rather than the whole group — widen to the enclosing
    // radio-group / fieldset so the group is still detected.
    const wider = container.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (wider instanceof HTMLElement && wider !== container) radios = radiosOf(wider);
  }
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

// --- Toggle-button groups -------------------------------------------------

/**
 * Some ATS forms (Ashby's "Will you be able to work on-site?" Yes/No
 * widget, Greenhouse's equivalent) render a boolean/choice question as a
 * pair of `<button aria-pressed>` elements wired to a hidden, unlabeled
 * `<input type="checkbox">` rather than as native radios — invisible to
 * `radioGroupsIn` and excluded from `fillableFieldsIn` (button/checkbox
 * types). Detected the same way as a radio group: 2+ pressed-state buttons
 * sharing an immediate parent.
 */
const BUTTON_GROUP_SELECTOR = 'button[aria-pressed], [role="button"][aria-pressed]';

/** Visible label of one toggle-button option. */
export function buttonOptionLabel(btn: HTMLElement): string {
  return collapse(btn.textContent ?? "") || btn.getAttribute("aria-label") || btn.getAttribute("data-option") || "";
}

/** Toggle-button groups inside `container`, grouped by immediate parent (mirrors `radioGroupsIn`). */
function buttonGroupsIn(container: HTMLElement): { groupEl: HTMLElement; buttons: HTMLElement[] }[] {
  const buttons = queryFillableDeep(BUTTON_GROUP_SELECTOR, container).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !(el as HTMLButtonElement).disabled,
  );
  const byParent = new Map<HTMLElement, HTMLElement[]>();
  for (const btn of buttons) {
    const parent = btn.parentElement;
    if (!parent) continue;
    byParent.set(parent, [...(byParent.get(parent) ?? []), btn]);
  }
  return [...byParent.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([groupEl, group]) => ({ groupEl, buttons: group }));
}

/**
 * The question a toggle-button group asks. Unlike a radio-group fieldset,
 * the prompt usually lives *outside* the group container (a sibling
 * `<label>` in the enclosing field entry, not a `<legend>` inside it) — so
 * this checks inside the group first, same as `radioGroupQuestion`, then
 * falls back to `fieldQuestionText`'s preceding-sibling climb, which is what
 * actually finds it for Ashby's markup.
 */
function buttonGroupQuestion(groupEl: HTMLElement, buttons: HTMLElement[], container: HTMLElement): string {
  const parts: string[] = [];
  for (const el of groupEl.querySelectorAll("legend, label, h1, h2, h3, h4, h5, h6, p")) {
    if (buttons.some((b) => b === el || b.contains(el))) continue;
    const text = collapse(el.textContent ?? "");
    if (text && !parts.some((p) => p.includes(text))) parts.push(text);
  }
  return collapse(parts.join(" — ")).slice(0, 500) || fieldQuestionText(groupEl, container);
}

// --- Checkbox groups (select-all-that-apply) ------------------------------

/**
 * "Select all that apply" checkbox groups (Ashby's "which of these
 * technologies…") have no shared `name` to group by the way radios do —
 * each option's checkbox is individually named after its own value
 * (`name="TypeScript"`, `name="React.js"`, …) — so this groups purely by
 * the nearest shared `fieldset`/`[role="group"]`, same fallback
 * `groupContainerOf` would use if radios ever lacked a `name` too.
 */
function checkboxGroupsIn(container: HTMLElement): { groupEl: HTMLElement; checkboxes: HTMLInputElement[] }[] {
  const checkboxes = queryFillableDeep('input[type="checkbox"]', container).filter(
    (el): el is HTMLInputElement => el instanceof HTMLInputElement && !el.disabled,
  );
  const byGroup = new Map<HTMLElement, HTMLInputElement[]>();
  for (const cb of checkboxes) {
    const group = cb.closest("fieldset") ?? cb.closest('[role="group"]');
    if (!(group instanceof HTMLElement)) continue;
    byGroup.set(group, [...(byGroup.get(group) ?? []), cb]);
  }
  return [...byGroup.entries()]
    .filter(([, group]) => group.length >= 2)
    .map(([groupEl, group]) => ({ groupEl, checkboxes: group }));
}

/** Same shape of prompt-extraction as `radioGroupQuestion` — the group's own legend/label, minus each option row's text. */
function checkboxGroupQuestion(groupEl: HTMLElement, checkboxes: HTMLInputElement[], container: HTMLElement): string {
  const optionRows = new Set<Element>();
  for (const cb of checkboxes) {
    const row = topLevelChild(groupEl, cb);
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

  // One malformed field (a property getter on a web-component that throws, a
  // detached node) must not abort the whole decompose — skip it and keep the
  // rest of the pick usable.
  for (const el of fillableFieldsIn(container)) {
    try {
      // A field the autofill engine already recognises (email, phone,
      // LinkedIn, country…) should just be filled from the profile, never
      // turned into an AI question.
      if (detectSemanticField(el)) {
        semanticCount++;
        continue;
      }
      const question = fieldQuestionText(el, container).slice(0, 400);
      const input = el as HTMLInputElement;
      const options = nativeFieldOptions(el);
      picked.push({
        locator: buildLocator(el, question),
        question,
        confident: isQuestionShaped(question),
        options,
        numeric: wantsNumericValue(el) || undefined,
        dateKind: dateInputKind(el) ?? undefined,
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
    } catch {
      /* skip this field */
    }
  }

  try {
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
  } catch {
    /* radio-group detection failed on this block — the free-text fields above still stand */
  }

  try {
    for (const { groupEl, buttons } of buttonGroupsIn(container)) {
      const question = buttonGroupQuestion(groupEl, buttons, container);
      const options = buttons.map(buttonOptionLabel).filter(Boolean);
      picked.push({
        locator: buildLocator(groupEl, question),
        question,
        confident: isQuestionShaped(question) && options.length > 0,
        options,
        descriptor: {
          index: picked.length,
          tag: "buttongroup",
          type: "button",
          name: "",
          placeholder: "",
          nearbyText: question.slice(0, 300),
          options,
        },
      });
    }
  } catch {
    /* button-group detection failed on this block — everything else above still stands */
  }

  try {
    for (const { groupEl, checkboxes } of checkboxGroupsIn(container)) {
      const question = checkboxGroupQuestion(groupEl, checkboxes, container);
      const options = checkboxes.map(radioOptionLabel).filter(Boolean);
      picked.push({
        locator: buildLocator(groupEl, question),
        question,
        confident: isQuestionShaped(question) && options.length > 0,
        options,
        multi: true,
        descriptor: {
          index: picked.length,
          tag: "checkboxgroup",
          type: "checkbox",
          name: "",
          placeholder: "",
          nearbyText: question.slice(0, 300),
          options,
        },
      });
    }
  } catch {
    /* checkbox-group detection failed on this block — everything else above still stands */
  }

  let blockText = "";
  try {
    blockText = (container.innerText || "").slice(0, 6000);
  } catch {
    /* innerText can throw on a detached / cross-origin-ish node */
  }
  return { picked, blockText, semanticCount };
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

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The `<label>` that activates radio `r` — its `for=` label, or a wrapping one. */
function radioLabelElement(r: HTMLInputElement): HTMLElement | null {
  if (r.id) {
    const root = r.getRootNode() as Document | ShadowRoot;
    const forLabel = root.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(r.id)}"]`);
    if (forLabel) return forLabel;
  }
  return r.closest("label");
}

export function radioOptionMatches(r: HTMLInputElement, answer: string): number {
  const a = normText(answer);
  const label = normText(radioOptionLabel(r));
  const value = normText(r.value);
  if (label === a || value === a) return 2;
  if (label.length > 0 && (label.includes(a) || a.includes(label))) return 1;
  return 0;
}

function selectRadioOption(radios: HTMLInputElement[], answer: string): boolean {
  const target = radios
    .map((r) => ({ r, score: radioOptionMatches(r, answer) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)[0]?.r;
  if (!target) return false;
  if (target.checked) return true;

  const label = radioLabelElement(target);
  target.focus?.();
  target.click();
  // Many custom radios (Ashby, Greenhouse) visually hide the <input> and
  // wire the handler to the <label> / option row — click that too.
  if (!target.checked && label) label.click();
  if (!target.checked) {
    // Last resort for a controlled group: set `.checked` through the native
    // prototype setter and desync React's value tracker so its own change
    // handler still fires.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(target, true);
    (target as unknown as { _valueTracker?: { setValue(v: string): void } })._valueTracker?.setValue("");
  }
  // Fire these unconditionally — `.click()` may have set `.checked` without
  // the framework's controlled-input handler noticing.
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return target.checked;
}

/** Toggle buttons belonging to the group `el` represents (a group container, or one button of the group). */
function buttonsForGroup(el: HTMLElement): HTMLElement[] {
  if (el.matches(BUTTON_GROUP_SELECTOR)) {
    const parent = el.parentElement;
    return parent ? Array.from(parent.querySelectorAll<HTMLElement>(BUTTON_GROUP_SELECTOR)) : [el];
  }
  return Array.from(el.querySelectorAll<HTMLElement>(BUTTON_GROUP_SELECTOR));
}

export function buttonOptionMatches(b: HTMLElement, answer: string): number {
  const a = normText(answer);
  const label = normText(buttonOptionLabel(b));
  if (label === a) return 2;
  if (label.length > 0 && (label.includes(a) || a.includes(label))) return 1;
  return 0;
}

/**
 * Fires the full pointer-down → mouse-down → pointer-up → mouse-up → click
 * sequence a real click produces, not just a bare `.click()`. Confirmed live
 * on Ashby's Yes/No widget: a plain `.click()` left `aria-pressed` and the
 * option's own "active" styling class untouched even though the button is
 * perfectly clickable by hand — its press state is wired to
 * `pointerdown`/`mousedown`, not (only) `click`, which `.click()` alone
 * never dispatches. `PointerEvent` is guarded since jsdom (the test
 * fixture's environment) doesn't implement it; `view` is omitted entirely —
 * passing `window` explicitly throws in jsdom ("member view is not of type
 * Window", a known quirk of its event constructors) and browsers already
 * default it to the current window when left out.
 */
function fireClick(el: HTMLElement): void {
  const opts: MouseEventInit = { bubbles: true, cancelable: true, composed: true };
  if (typeof PointerEvent !== "undefined") el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.focus?.();
  if (typeof PointerEvent !== "undefined") el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1 }));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
}

function selectButtonGroupOption(buttons: HTMLElement[], answer: string): boolean {
  const target = buttons
    .map((b) => ({ b, score: buttonOptionMatches(b, answer) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)[0]?.b;
  if (!target) return false;
  if (target.getAttribute("aria-pressed") === "true") return true;

  fireClick(target);
  if (target.getAttribute("aria-pressed") !== "true") {
    // No handler responded to any of the above (the test fixture, which
    // never runs the page's own JS, or a framework wired to something even
    // this sequence doesn't cover) — force the pressed state directly,
    // mirroring `checkboxes.ts#setChecked`'s fallback.
    for (const b of buttons) b.setAttribute("aria-pressed", String(b === target));
  }
  return target.getAttribute("aria-pressed") === "true";
}

/** Checkboxes belonging to the group `el` represents (a group container, or one checkbox of the group). */
function checkboxesForGroup(el: HTMLElement): HTMLInputElement[] {
  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const scope = el.closest("fieldset") ?? el.ownerDocument;
    return Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((c) => !c.disabled);
  }
  return Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).filter((c) => !c.disabled);
}

/** The AI's " | "-joined multi-select answer (see `answer-question.ts#MULTI_CHOICE_RULE`), split back into individual option labels. */
function splitMultiAnswer(answer: string): string[] {
  return answer
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Checks every checkbox whose label matches one of `answer`'s " | "-separated options; leaves the rest untouched. Returns how many changed. */
function selectCheckboxGroupOptions(checkboxes: HTMLInputElement[], answer: string): number {
  const wanted = splitMultiAnswer(answer).map(normText);
  if (wanted.length === 0) return 0;
  let changed = 0;
  for (const cb of checkboxes) {
    const label = normText(radioOptionLabel(cb));
    if (!wanted.includes(label)) continue;
    if (setChecked(cb, true)) changed++;
  }
  return changed;
}

/**
 * Writes AI answers into fields identified by locator (the manual-picker
 * counterpart to `fillCustomQuestionAnswers`, which matches by question
 * text). Handles radio groups (click the option whose label matches),
 * `<select>`, a flyout-driven react-select-style combobox (clicks the
 * matching `[role="option"]` row — see `fillComboboxAnswer`) as well as
 * free text. Never clobbers an answer the user already gave. Returns how
 * many were filled, plus the `question` text (when the caller supplied one)
 * of any item that had an answer ready but couldn't be written in, so the
 * Side Panel can tell the user to answer those manually.
 *
 * Async, and fields are filled one at a time (not `Promise.all`) for the
 * same reason `fillCustomQuestionAnswers` is: a flyout combobox answer opens
 * and closes its own widget, and two open at once can steal each other's
 * focus (see `combobox.ts`).
 */
export async function fillAnswersByLocator(
  items: { locator: ElementLocator; answer: string; question?: string }[],
): Promise<{ filled: number; unfilled: string[] }> {
  let filled = 0;
  const unfilled: string[] = [];
  for (const { locator, answer, question } of items) {
    try {
      if (!answer) continue;
      const el = resolveLocator(locator);
      if (!el) continue;

      const radios = radiosForGroup(el);
      if (radios.length > 0) {
        // This is an explicitly picked field, so set the requested option even
        // when the form pre-selected a default — skip only when the option
        // already checked is the one we'd choose anyway.
        const current = radios.find((r) => r.checked);
        if (current && radioOptionMatches(current, answer) >= 2) continue;
        if (selectRadioOption(radios, answer)) filled++;
        else if (question) unfilled.push(question);
        continue;
      }

      const buttons = buttonsForGroup(el);
      if (buttons.length > 0) {
        const current = buttons.find((b) => b.getAttribute("aria-pressed") === "true");
        if (current && buttonOptionMatches(current, answer) >= 2) continue;
        if (selectButtonGroupOption(buttons, answer)) filled++;
        else if (question) unfilled.push(question);
        continue;
      }

      const checkboxes = checkboxesForGroup(el);
      if (checkboxes.length > 0) {
        if (selectCheckboxGroupOptions(checkboxes, answer) > 0) filled++;
        else if (question) unfilled.push(question);
        continue;
      }

      if (el instanceof HTMLSelectElement) {
        if (el.value && el.selectedIndex > 0) continue;
        if (fillElement(el, answer)) filled++;
        else if (question) unfilled.push(question);
        continue;
      }

      if (!isEmptyField(el)) continue;
      if (await fillComboboxAnswer(el, answer)) filled++;
      else if (question) unfilled.push(question);
    } catch {
      // one field's write failed — keep filling the rest, but still report
      // it as needing a manual answer rather than dropping it silently
      if (question) unfilled.push(question);
    }
  }
  return { filled, unfilled };
}
