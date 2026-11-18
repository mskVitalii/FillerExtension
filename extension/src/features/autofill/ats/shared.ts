import { coerceDateInputValue } from "@/lib/date-format";
import { collapse } from "../field-signal";
import { typeSearchText } from "../native-setter";

/**
 * Helpers several ATS adapters need: the text of the ATS's own markup, option matching,
 * user-like clicks and typing, date shapes, demographic-survey sections.
 */

export { salutationCandidates } from "@/lib/salutation";

/** Whitespace-collapsed text of `el`, or "". */
export function textOf(el: Element | null | undefined): string {
  return collapse(el?.textContent ?? "");
}

/** Drops a trailing required marker ("*", Lever's "✱"). */
export function withoutRequiredMarker(text: string): string {
  return text.replace(/[\s*✱]+$/, "").trim();
}

/** First enabled button whose text matches `re`. */
export function buttonByText(doc: Document, re: RegExp, scope = "button, [role='button']"): HTMLElement | null {
  for (const el of doc.querySelectorAll<HTMLElement>(scope)) {
    if ((el as HTMLButtonElement).disabled) continue;
    if (re.test(textOf(el))) return el;
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until `probe` returns something truthy, or `timeoutMs` passes. */
export async function waitFor<T>(probe: () => T | null | undefined | false, timeoutMs = 1500, stepMs = 25): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = probe();
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await sleep(stepMs);
  }
}

/** Lowercased, accents and trailing punctuation kept out, single-spaced. */
export function normOption(text: string): string {
  return collapse(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.:*]+$/g, "")
    .trim();
}

/**
 * The option text that best answers `candidates` (tried in order): an exact match first,
 * then an option starting with the candidate ("Germany (+49)" for "Germany"), then one
 * containing it as a whole word. Short candidates ("DE") only ever match exactly, so an
 * ISO code can't pick "Deutsche Bank Career Site".
 */
export function pickBestOption(texts: string[], candidates: string[]): string | null {
  const opts = texts.map((t) => ({ text: t, norm: normOption(t) })).filter((o) => o.norm);
  const wanted = candidates.map(normOption).filter(Boolean);
  for (const w of wanted) {
    const exact = opts.find((o) => o.norm === w);
    if (exact) return exact.text;
  }
  for (const w of wanted) {
    if (w.length < 3) continue;
    const starts = opts.find((o) => o.norm.startsWith(`${w} `) || o.norm.startsWith(`${w}(`));
    if (starts) return starts.text;
  }
  for (const w of wanted) {
    if (w.length < 4) continue;
    const re = new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    const inside = opts.find((o) => re.test(o.norm));
    if (inside) return inside.text;
  }
  return null;
}

/** mousedown → mouseup → click, the sequence a real click produces. */
export function clickLikeUser(el: HTMLElement): void {
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

export function pressKey(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, bubbles: true, cancelable: true }));
}

/**
 * Types `value` as a user would (`typeSearchText`: native setter, `input`, key events — no blur,
 * so a search box isn't committed before its results render), then commits: `change` and blur,
 * as leaving the field does.
 */
export function typeAndCommit(input: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  typeSearchText(input, value);
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new FocusEvent("blur"));
  input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  return input.value === value;
}

/** Rendered (laid out, or `position: fixed`), and not inside a `[hidden]` / `aria-hidden` subtree. */
export function isShown(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  return el.offsetParent !== null || getComputedStyle(el).position === "fixed";
}

export interface YearMonthDay {
  year: number;
  month: number | null;
  day: number | null;
}

/** "2021-04", "2021", "04/2021", "2021-04-15", "15.04.2021", "April 2021" → parts. Null when unreadable. */
export function parseDateParts(raw: string): YearMonthDay | null {
  const s = raw.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/);
  if (m) return { year: +m[1], month: m[2] ? +m[2] : null, day: m[3] ? +m[3] : null };
  m = s.match(/^(\d{1,2})[/.](\d{4})$/);
  if (m) return { year: +m[2], month: +m[1], day: null };
  const iso = coerceDateInputValue("date", s);
  if (iso) {
    const [y, mo, d] = iso.split("-").map(Number);
    return { year: y, month: mo, day: d };
  }
  const month = coerceDateInputValue("month", s);
  if (month) {
    const [y, mo] = month.split("-").map(Number);
    return { year: y, month: mo, day: null };
  }
  return null;
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Renders a date in a UI5/Java-style pattern ("dd.MM.yyyy", "MM/dd/yyyy", "MMM d, y",
 * "yyyy-MM-dd") — the shape a SuccessFactors date field's placeholder announces.
 */
export function formatDatePattern(parts: YearMonthDay, pattern: string): string {
  const month = parts.month ?? 1;
  const day = parts.day ?? 1;
  return pattern.replace(/y+|M+|d+/g, (token) => {
    switch (token[0]) {
      case "y":
        return token.length === 2 ? String(parts.year).slice(-2) : String(parts.year);
      case "M":
        if (token.length >= 3) return MONTHS_EN[month - 1];
        return token.length === 2 ? String(month).padStart(2, "0") : String(month);
      default:
        return token.length === 2 ? String(day).padStart(2, "0") : String(day);
    }
  });
}

/** True for a placeholder that is a date pattern ("dd.MM.yyyy", "MM/DD/YYYY", "TT.MM.JJJJ", "MMM d, y"). */
export function datePatternOf(placeholder: string | null | undefined): string | null {
  const p = (placeholder ?? "").trim();
  if (!p || p.length > 14) return null;
  const java = p.replace(/TT/g, "dd").replace(/JJJJ/g, "yyyy").replace(/DD/g, "dd").replace(/YYYY/g, "yyyy");
  if (/^(?=.*y)(?=.*M)[yMd]+([./\-, ]+[yMd]+){1,2}$/.test(java)) return java;
  return null;
}

/** Text of the section heading a field sits under: its `role="group"`'s label, else the nearest h2–h4 above it. */
export function sectionHeading(el: HTMLElement): string {
  const group = el.closest<HTMLElement>("[role='group'][aria-labelledby], fieldset");
  if (group) {
    const id = group.getAttribute("aria-labelledby");
    const label = id ? el.ownerDocument.getElementById(id)?.textContent : group.querySelector("legend")?.textContent;
    if (label && collapse(label)) return collapse(label);
  }
  let node: Element | null = el;
  for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
    let prev = node.previousElementSibling;
    while (prev) {
      if (/^H[1-4]$/.test(prev.tagName)) return collapse(prev.textContent ?? "");
      prev = prev.previousElementSibling;
    }
  }
  return "";
}

/**
 * Voluntary self-identification surveys (EEO, diversity, demographics), as ATSs title them. Kept
 * here so every adapter recognises the same wording.
 */
export const DEMOGRAPHIC_HEADING_RE =
  /equal\s+employment|\beeo(c)?\b|demographic|diversity|self[-\s]?identif|voluntary\s+(disclosure|survey|information)|inclusion\s+survey|vielfalt|diversität/i;

/** True when `el` sits in a section whose heading (per the ATS's markup) reads as a demographic survey. */
export function inSectionHeaded(el: HTMLElement, sectionSelector: string, headingSelector: string, re = DEMOGRAPHIC_HEADING_RE): boolean {
  for (let section = el.closest<HTMLElement>(sectionSelector); section; section = section.parentElement?.closest<HTMLElement>(sectionSelector) ?? null) {
    const heading = section.querySelector(headingSelector);
    if (heading && re.test(heading.textContent ?? "")) return true;
  }
  return false;
}
