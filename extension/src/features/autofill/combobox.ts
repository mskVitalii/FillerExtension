import { collapse } from "./field-signal";
import { fillElement, typeSearchText } from "./native-setter";

/**
 * Shared react-select-style "flyout" combobox handling (spec_5 section A;
 * confirmed live on greenhouse.io). Used both to *read* a field's hidden
 * choice list before asking the AI a question (`revealComboboxOptions`,
 * called from `custom-questions.ts`) and to *write* the chosen answer back
 * by clicking the matching option (`fillComboboxAnswer`, called from both
 * `custom-questions.ts` and `pick-questions.ts`) — one place so both agree
 * on how such a widget opens/closes and what counts as its option rows.
 */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isVisible(el: Element): boolean {
  return el instanceof HTMLElement && el.offsetParent !== null;
}

/** True for a field that advertises itself as a combobox with a hidden option list, not just any text input. */
export function isComboboxLike(el: HTMLElement): boolean {
  if (el.getAttribute("role") === "combobox") return true;
  const autocomplete = el.getAttribute("aria-autocomplete");
  if (autocomplete === "list" || autocomplete === "both") return true;
  return el.getAttribute("aria-haspopup") === "listbox";
}

const OPTION_SELECTOR = '[role="option"], [id^="react-select-"][id*="-option-"]';

function collectOptionEls(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(isVisible);
}

const TOGGLE_BUTTON_RE = /toggle|flyout|dropdown|expand/i;

/**
 * react-select-style widgets (confirmed live on greenhouse.io) route
 * opening the menu through a dedicated indicator button next to the input
 * (there: `<button aria-label="Toggle flyout">`) rather than through a
 * mousedown/click on the input itself — dispatching those on the input
 * alone silently does nothing on that build. Climbs a few ancestor levels
 * from the combobox looking for a button whose `aria-label` reads as a
 * menu-toggle, matched broadly (not just Greenhouse's exact wording) since
 * react-select's indicator-button pattern is common to any ATS built on it.
 */
export function findFlyoutToggle(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const button = Array.from(node.querySelectorAll("button")).find((b) =>
      TOGGLE_BUTTON_RE.test(b.getAttribute("aria-label") ?? ""),
    );
    if (button) return button;
  }
  return null;
}

/**
 * react-select's Control `<div>` — where a real user's mousedown lands
 * (captured live on greenhouse.io: `mousedown` on a class-only `div`, then
 * the input receives focus). Matches both a `classNamePrefix` build
 * (`select__control`) and the default emotion one (`css-xyz-control`).
 */
function findSelectControl(el: HTMLElement): HTMLElement | null {
  // A wrapper, never the field itself: Bootstrap's `form-control` on a plain input isn't one.
  return el.parentElement?.closest<HTMLElement>('[class*="__control"], [class*="-control"]') ?? null;
}

/** A react-select instance, recognisable by its generated ids or its Control wrapper. */
export function isReactSelectLike(el: HTMLElement): boolean {
  return /^react-select-/.test(el.id) || findSelectControl(el) !== null;
}

/**
 * What a react-select-style widget shows as chosen: its single value, or its
 * multi-value chips joined with ", ". Its `<input>` holds only the search
 * text, which react-select clears right after a pick — reading that reports
 * every real selection as empty. Null when `el` isn't such a widget.
 */
export function comboboxShownValue(el: HTMLElement): string | null {
  if (!isComboboxLike(el)) return null;
  const control = el.closest<HTMLElement>('[class*="__control"], [class*="-control"]');
  if (!control || control === el) return null;
  const single = control.querySelector('[class*="singleValue"], [class*="single-value"]');
  if (single) return collapse(single.textContent ?? "");
  const chips = Array.from(control.querySelectorAll('[class*="multiValue__label"], [class*="multi-value__label"]'))
    .map((n) => collapse(n.textContent ?? ""))
    .filter(Boolean);
  return chips.join(", ");
}

/** react-select's own option-id prefix for this widget, `react-select-<instanceId>-option-`. */
function reactSelectOptionPrefix(el: HTMLElement): string | null {
  const own = el.id.match(/^react-select-(.+)-input$/);
  if (own) return `react-select-${own[1]}-option-`;
  // Greenhouse passes the question id as both `inputId` and `instanceId`.
  return el.id ? `react-select-${el.id}-option-` : null;
}

/**
 * This widget's currently rendered option rows. `allowDocumentScan` adds a
 * last-resort whole-page scan for a widget that references no listbox and
 * follows no id scheme — only safe once *this* widget was just opened,
 * never as an "is it already open?" check, where it would pick up a
 * sibling widget's still-open menu.
 */
function widgetOptionEls(el: HTMLElement, allowDocumentScan: boolean): HTMLElement[] {
  const ownedId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  const owned = ownedId ? document.getElementById(ownedId) : null;
  if (owned) {
    const options = collectOptionEls(owned);
    if (options.length > 0) return options;
  }
  const prefix = reactSelectOptionPrefix(el);
  if (prefix) {
    // Filtered by `startsWith` rather than an `[id^=…]` selector: ATS question ids can hold characters a selector would need escaped.
    const options = Array.from(document.querySelectorAll<HTMLElement>('[id^="react-select-"]')).filter(
      (n) => n.id.startsWith(prefix) && isVisible(n),
    );
    if (options.length > 0) return options;
  }
  return allowDocumentScan ? collectOptionEls(document) : [];
}

function mouse(target: HTMLElement, type: "mousedown" | "mouseup" | "click"): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
}

const OPEN_SETTLE_MS = 60;

/**
 * Opens a flyout combobox, verifying after each step that *its own* option
 * rows actually rendered before trying the next one — a step on an
 * already-open react-select would toggle it shut again.
 *
 * The order is deliberate. Autofill runs while the Side Panel, not the page,
 * holds focus, and in that state Chrome's `el.focus()` moves `activeElement`
 * without dispatching `focus`/`focusin`. react-select opens from a Control
 * mousedown only *after* its input's focus event (`openAfterFocus`), so the
 * exact gesture a user makes (mousedown on the Control) silently stalls:
 *
 * 1. mousedown/mouseup/click on the Control, as a real user does — works
 *    whenever the page does have focus;
 * 2. a synthetic `focusin`/`focus` on the input, completing step 1's
 *    stalled "open after focus" (React's `onFocus` listens to `focusin`);
 * 3. ArrowDown on the input — react-select opens its menu on it with no
 *    focus requirement at all;
 * 4. mousedown on the dropdown indicator / "Toggle flyout" button (no
 *    click: the indicator toggles on mousedown, and a second toggle from
 *    a click handler would close what it just opened).
 *
 * A plain `role="combobox"` widget with no react-select markers only gets
 * the generic mousedown/focus/click on the input itself.
 */
async function openFlyout(el: HTMLElement, scoped = false): Promise<HTMLElement[]> {
  let options = widgetOptionEls(el, false);
  if (options.length > 0) return options;

  const steps: (() => void)[] = [];
  const control = findSelectControl(el);
  if (control) {
    steps.push(() => {
      mouse(control, "mousedown");
      el.focus?.();
      mouse(control, "mouseup");
      mouse(control, "click");
    });
    steps.push(() => {
      el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      el.dispatchEvent(new FocusEvent("focus"));
    });
    steps.push(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true }));
    });
  }
  const toggle = findFlyoutToggle(el);
  if (toggle) {
    steps.push(() => mouse(toggle, "mousedown"));
  } else if (!control) {
    steps.push(() => {
      mouse(el, "mousedown");
      el.focus?.();
      mouse(el, "click");
    });
    // A plain ARIA combobox (Ashby's autocomplete, Downshift) opens its list on ArrowDown, with
    // no focus event needed — which, with the Side Panel holding focus, `focus()` doesn't fire.
    steps.push(() => {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", keyCode: 40, bubbles: true, cancelable: true } as KeyboardEventInit));
    });
  }

  for (const step of steps) {
    step();
    await delay(OPEN_SETTLE_MS);
    options = widgetOptionEls(el, documentScanAllowed(el, scoped));
    if (options.length > 0) return options;
  }
  return [];
}

/**
 * Whether a whole-page option scan may stand in for this widget's own list. `scoped` callers
 * (a combobox with no flyout markers, which may never open at all) only trust one when the
 * widget itself says it's expanded — otherwise an unrelated listbox elsewhere on the page
 * would be read as its options.
 */
function documentScanAllowed(el: HTMLElement, scoped: boolean): boolean {
  return !scoped || el.getAttribute("aria-expanded") === "true";
}

/**
 * A widget whose value only changes by clicking an option row — typing into it is never a real selection.
 * A `<button aria-haspopup="listbox">` (Workday, Headless UI's Listbox) can't take text at all.
 */
function isFlyoutOnly(el: HTMLElement): boolean {
  return el instanceof HTMLButtonElement || isReactSelectLike(el) || findFlyoutToggle(el) !== null;
}

function closeFlyout(el: HTMLElement): void {
  try {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    el.blur?.();
  } catch {
    /* best-effort close — nothing left to do if even this throws */
  }
}

/**
 * spec_5 section A, second half: some custom-built dropdowns carry no
 * `<select>`/`<datalist>` at all — their option list only exists in the DOM
 * once the widget is opened. For a field that already advertises itself as
 * a combobox (`isComboboxLike`), open it — preferring a nearby menu-toggle
 * button (`findFlyoutToggle`) over interacting with the input itself, since
 * a react-select-style widget (confirmed live on greenhouse.io) routes
 * opening through that button alone — give the widget a brief moment to
 * render its listbox, read whichever `[role="option"]` rows appeared under
 * its own `aria-controls`/`aria-owns` target (falling back to a
 * whole-document scan for a widget that omits that reference), then close
 * it again — Escape + blur — so nothing is left open or changed on the
 * page, even if something above threw first (`finally`). Deliberately
 * scoped to combobox-shaped fields rather than every text input: blindly
 * clicking an arbitrary field would just as easily pop open a native date
 * picker or a file dialog.
 *
 * Callers MUST run this one field at a time, never concurrently
 * (`detectCustomQuestions` does) — `el.focus()` blurs (and, on most real
 * widgets, closes) whatever combobox a sibling probe just opened, and even
 * the `aria-controls`-scoped scan can't help if two widgets are both open
 * and mid-render at once.
 */
export async function revealComboboxOptions(el: HTMLElement): Promise<string[] | undefined> {
  if (!isComboboxLike(el)) return undefined;
  try {
    const texts = (await openFlyout(el)).map((n) => collapse(n.textContent ?? "")).filter(Boolean);
    const options = [...new Set(texts)].slice(0, 30);
    return options.length > 0 ? options : undefined;
  } catch {
    return undefined;
  } finally {
    closeFlyout(el);
  }
}

/** Lowercased words only: punctuation, accents' case and runs of spaces don't decide a match. */
const normText = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** `phrase` occurs in `text` as whole words ("linkedin" in "via linkedin", not "other" in "another"). */
function hasPhrase(text: string, phrase: string): boolean {
  return phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);
}

/**
 * The option text that best matches `answer`: the same words regardless of case, punctuation or
 * spacing ("LinkedIn" = "Linkedin" = "Linked-in"), else an option named in the answer ("I saw
 * it on LinkedIn") or an answer that is part of an option ("Referral" → "Employee referral").
 * Among several partial matches the one closest in length to the answer wins; a bare
 * substring inside a word never counts.
 */
export function bestTextMatch(texts: string[], answer: string): string | null {
  const a = normText(answer);
  if (!a) return null;
  let best: { text: string; score: number } | null = null;
  for (const text of texts) {
    const norm = normText(text);
    if (!norm) continue;
    let score = 0;
    if (norm === a || norm.replace(/ /g, "") === a.replace(/ /g, "")) score = 1000;
    else if (hasPhrase(a, norm) || hasPhrase(norm, a)) score = Math.max(1, 999 - Math.abs(norm.length - a.length));
    if (score > (best?.score ?? 0)) best = { text, score };
  }
  return best?.text ?? null;
}

interface ComboboxPickAttempt {
  picked: boolean;
  /**
   * True once the widget's own listbox actually rendered at least one
   * option row — false means every `openFlyout` step produced nothing.
   * Distinct from "menu opened but nothing matched the answer" (`picked:
   * false, menuOpened: true`); `fillComboboxAnswer` uses this flag to tell
   * the two apart.
   */
  menuOpened: boolean;
}

/**
 * A flyout-driven react-select widget (confirmed live on greenhouse.io,
 * including its `aria-multiselectable="true"` shape — e.g. a salary-range
 * question whose menu stays open after a choice) never accepts typed text:
 * its value only ever changes by clicking one of the option rows the opened
 * menu renders (see `openFlyout` for how it gets opened). Scoped to widgets
 * `isFlyoutOnly` recognises — a react-select or a combobox with a dedicated
 * toggle button; an ordinary typeahead combobox has no such signal and is
 * left to the caller's type-into-trigger fallback instead.
 *
 * `pickOption` chooses which of the currently rendered option *texts* to
 * click — a plain equality/substring match for an AI-answered question
 * (`fillComboboxAnswer`), or a salary-bracket match for the semantic
 * expected-salary field (`engine.ts`) — so this one open/read/click/close
 * sequence serves both callers.
 */
async function attemptComboboxPick(
  el: HTMLElement,
  pickOption: (optionTexts: string[]) => string | null,
  anyCombobox = false,
): Promise<ComboboxPickAttempt> {
  if (!isComboboxLike(el)) return { picked: false, menuOpened: false };
  const flyoutOnly = isFlyoutOnly(el);
  if (!flyoutOnly && !anyCombobox) return { picked: false, menuOpened: false };

  try {
    const options = await openFlyout(el, !flyoutOnly);
    if (options.length === 0) return { picked: false, menuOpened: false };

    const texts = options.map((opt) => collapse(opt.textContent ?? ""));
    const chosen = pickOption(texts);
    if (!chosen) return { picked: false, menuOpened: true };
    const target = options[texts.indexOf(chosen)];
    if (!target) return { picked: false, menuOpened: true };

    // react-select commits the choice in the option's onClick; the menu's
    // own mousedown handler keeps the input from blurring first. Mirrors
    // the live Greenhouse sequence: mousedown → mouseup → click on the row.
    mouse(target, "mousedown");
    mouse(target, "mouseup");
    mouse(target, "click");
    await delay(50);
    return { picked: true, menuOpened: true };
  } catch {
    return { picked: false, menuOpened: false };
  } finally {
    closeFlyout(el);
  }
}

export async function fillComboboxByPicking(
  el: HTMLElement,
  pickOption: (optionTexts: string[]) => string | null,
): Promise<boolean> {
  return (await attemptComboboxPick(el, pickOption)).picked;
}

const SEARCH_POLL_MS = 100;
const SEARCH_TIMEOUT_MS = 3000;

function clickOption(option: HTMLElement): void {
  mouse(option, "mousedown");
  mouse(option, "mouseup");
  mouse(option, "click");
}

/**
 * A typeahead whose options only exist once a search term is typed: an async react-select
 * (Greenhouse "Location (City)"), Ashby's location autocomplete. Tries the already-rendered list
 * first (a static dropdown), then types `query` (no blur — see `typeSearchText`), waits for the
 * widget's own result rows and clicks the one `pickOption` chooses. When nothing suitable shows
 * up the typed text is cleared again, so no half-entered search is left looking like an answer.
 */
export async function fillComboboxBySearch(
  el: HTMLElement,
  query: string,
  pickOption: (optionTexts: string[]) => string | null,
  timeoutMs = SEARCH_TIMEOUT_MS,
): Promise<boolean> {
  if (!(el instanceof HTMLInputElement) || !isComboboxLike(el)) return false;
  if (isFlyoutOnly(el) && (await attemptComboboxPick(el, pickOption)).picked) return true;
  return searchAndPick(el, query, pickOption, timeoutMs, false);
}

/**
 * Types `query` (no blur), waits for the widget's result rows and clicks the one `pickOption`
 * chooses; clears the typed text again when none suits. `scoped`: see `documentScanAllowed`.
 */
async function searchAndPick(
  el: HTMLInputElement,
  query: string,
  pickOption: (optionTexts: string[]) => string | null,
  timeoutMs: number,
  scoped: boolean,
): Promise<boolean> {
  try {
    typeSearchText(el, query);
    for (let waited = 0; waited <= timeoutMs; waited += SEARCH_POLL_MS) {
      await delay(waited === 0 ? 0 : SEARCH_POLL_MS);
      const options = widgetOptionEls(el, documentScanAllowed(el, scoped));
      if (options.length === 0) continue;
      const texts = options.map((opt) => collapse(opt.textContent ?? ""));
      const chosen = pickOption(texts);
      if (!chosen) continue;
      clickOption(options[texts.indexOf(chosen)]);
      await delay(50);
      return true;
    }
    typeSearchText(el, "");
    return false;
  } finally {
    closeFlyout(el);
  }
}

const ANSWER_SEARCH_TIMEOUT_MS = 1200;

/**
 * Fills a `role="combobox"`-shaped field's AI-generated answer the way its
 * own widget actually expects: by clicking the `[role="option"]` row that
 * matches it (`bestTextMatch`).
 *
 * 1. Open the widget and pick from its full list (`attemptComboboxPick`) —
 *    a react-select or toggle-button flyout, and also a plain ARIA
 *    combobox such as Ashby's autocomplete, which opens on ArrowDown.
 * 2. A typeahead whose rows only appear for a search term: type the answer,
 *    wait for the widget's own rows and click the match. Typed text alone is
 *    never a selection there — Ashby discards it on blur, which is how "How
 *    did you find out about this position?" used to end up empty although
 *    "Linkedin" was on the list.
 * 3. Only then fall back to `fillElement`'s plain typing, for a combobox
 *    that does accept free text.
 *
 * Never falls back to typing into a react-select, nor into any flyout-only
 * widget whose menu never opened: the typed text would sit in the search
 * box without ever becoming a real selection, leaving a required field
 * looking filled while its actual value stayed unset — worse than leaving
 * it untouched and reporting it as unfilled. A non-react-select flyout
 * whose menu *did* open but had nothing matching the answer is left to the
 * typing fallback — some of those do accept free text once open.
 */
export async function fillComboboxAnswer(el: HTMLElement, answer: string): Promise<boolean> {
  const pick = (texts: string[]) => bestTextMatch(texts, answer);
  const attempt = await attemptComboboxPick(el, pick, true);
  if (attempt.picked) return true;
  // A react-select that opened but had no matching row doesn't accept free text either.
  if (isComboboxLike(el) && isReactSelectLike(el)) return false;
  if (!attempt.menuOpened && isComboboxLike(el) && isFlyoutOnly(el)) return false;
  if (el instanceof HTMLInputElement && isComboboxLike(el) && !isFlyoutOnly(el)) {
    if (await searchAndPick(el, answer, pick, ANSWER_SEARCH_TIMEOUT_MS, true)) return true;
  }
  return fillElement(el, answer);
}
