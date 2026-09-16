import { collapse } from "./field-signal";
import { fillElement } from "./native-setter";

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

function collectOptionEls(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]')).filter(isVisible);
}

function collectOptionTexts(root: ParentNode): string[] {
  const texts = collectOptionEls(root)
    .map((n) => collapse(n.textContent ?? ""))
    .filter(Boolean);
  return [...new Set(texts)].slice(0, 30);
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

function openFlyout(el: HTMLElement, toggle: HTMLElement | null): void {
  if (toggle) {
    // The indicator button toggles the menu on its own mousedown handler —
    // also clicking/focusing the input here would fire a second, competing
    // toggle and likely close what the button just opened.
    toggle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  } else {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.focus?.();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
}

function closeFlyout(el: HTMLElement): void {
  try {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    el.blur?.();
  } catch {
    /* best-effort close — nothing left to do if even this throws */
  }
}

/** Where an opened widget's option rows live: its declared owned/controlled node, falling back to the whole document. */
function optionsScope(el: HTMLElement): ParentNode {
  const ownedId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  const owned = ownedId ? document.getElementById(ownedId) : null;
  return owned ?? document;
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
    openFlyout(el, findFlyoutToggle(el));
    await delay(200);

    const scope = optionsScope(el);
    let options = collectOptionTexts(scope);
    if (options.length === 0 && scope !== document) options = collectOptionTexts(document);

    return options.length > 0 ? options : undefined;
  } catch {
    return undefined;
  } finally {
    closeFlyout(el);
  }
}

const normText = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** The option text that best matches `answer` — exact match preferred, then a substring either way. */
function bestTextMatch(texts: string[], answer: string): string | null {
  const a = normText(answer);
  let best: { text: string; score: number } | null = null;
  for (const text of texts) {
    const norm = normText(text);
    if (!norm) continue;
    const score = norm === a ? 2 : norm.includes(a) || a.includes(norm) ? 1 : 0;
    if (score > 0 && score > (best?.score ?? 0)) best = { text, score };
  }
  return best?.text ?? null;
}

interface ComboboxPickAttempt {
  picked: boolean;
  /**
   * True once the widget's own listbox actually rendered at least one
   * `[role="option"]` row — false means opening the flyout produced nothing
   * at all, which live testing on a Greenhouse "Job Boards" posting
   * (job-boards.greenhouse.io's newer Remix-based UI, not the classic
   * boards.greenhouse.io embed) traced to that build's react-select gating
   * mousedown/click on `event.isTrusted`: every event a content script can
   * dispatch (`dispatchEvent`, `.click()`, `.focus()`, even a synthetic
   * `input` event) is silently ignored, so the menu never opens. Distinct
   * from "menu opened but nothing matched the answer" (`picked: false,
   * menuOpened: true`), which callers still treat as safe to fall back to
   * typing for — `fillComboboxAnswer` uses this flag to tell the two apart.
   */
  menuOpened: boolean;
}

/**
 * A flyout-driven react-select widget (confirmed live on greenhouse.io,
 * including its `aria-multiselectable="true"` shape — e.g. a salary-range
 * question whose menu stays open after a choice) never accepts typed text:
 * the trigger only opens via `findFlyoutToggle`'s button, and its value only
 * ever changes by clicking one of the `[role="option"]` rows the opened menu
 * renders. Deliberately scoped to a combobox that actually has such a toggle
 * button — an ordinary typeahead combobox (no dedicated toggle button next
 * to it) has no confirmed signal here and is left to the caller's
 * type-into-trigger fallback instead.
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
): Promise<ComboboxPickAttempt> {
  if (!isComboboxLike(el)) return { picked: false, menuOpened: false };
  const toggle = findFlyoutToggle(el);
  if (!toggle) return { picked: false, menuOpened: false };

  try {
    openFlyout(el, toggle);
    await delay(200);

    const scope = optionsScope(el);
    let options = collectOptionEls(scope);
    if (options.length === 0 && scope !== document) options = collectOptionEls(document);
    if (options.length === 0) return { picked: false, menuOpened: false };

    const texts = options.map((opt) => collapse(opt.textContent ?? ""));
    const chosen = pickOption(texts);
    if (!chosen) return { picked: false, menuOpened: true };
    const target = options[texts.indexOf(chosen)];
    if (!target) return { picked: false, menuOpened: true };

    // react-select (confirmed live on greenhouse.io) commits the choice on
    // mousedown — to win the race against the trigger's own blur-close —
    // not on click alone, so a plain `.click()` here would do nothing.
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

/**
 * Fills a `role="combobox"`-shaped field's AI-generated answer the way its
 * own widget actually expects: clicking a matching `[role="option"]` row for
 * a flyout-driven react-select-style dropdown (`attemptComboboxPick`),
 * falling back to `fillElement`'s type-into-trigger behavior for every other
 * shape — including a flyout that opened but had no option matching the
 * answer, or an ordinary field this module has nothing special to do with.
 *
 * Does *not* fall back to typing when the flyout never opened at all,
 * though (`menuOpened: false`) on a widget `findFlyoutToggle` confirms is
 * flyout-only: live testing on a Greenhouse "Job Boards" posting
 * (job-boards.greenhouse.io, its newer Remix-based UI, not the classic
 * boards.greenhouse.io embed) showed that build's react-select gates
 * mousedown/click on `event.isTrusted` — every content-script-dispatched
 * event (`dispatchEvent`, `.click()`, `.focus()`, even a synthetic `input`
 * event) is silently ignored, so the menu never opens and typed text would
 * never be a real selection, just leftover characters sitting in the search
 * box. Typing into a widget like that wouldn't fail loudly — it would leave
 * a required field looking filled while its actual value stayed unset, which
 * is worse than leaving it untouched and reporting it as unfilled. A widget
 * whose menu *did* open but had nothing matching the answer is left to the
 * typing fallback as before — some flyout widgets do accept free text once
 * open, and there's no gating signal to distrust there.
 */
export async function fillComboboxAnswer(el: HTMLElement, answer: string): Promise<boolean> {
  const attempt = await attemptComboboxPick(el, (texts) => bestTextMatch(texts, answer));
  if (attempt.picked) return true;
  if (!attempt.menuOpened && isComboboxLike(el) && findFlyoutToggle(el)) return false;
  return fillElement(el, answer);
}
