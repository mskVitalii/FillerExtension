/** Helpers several ATS adapters need: text of the ATS's own markup, buttons, user-like clicks. */

/** Whitespace-collapsed text of `el`, or "". */
export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
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

/** mousedown → mouseup → click, the sequence a real click produces. */
export function clickLikeUser(el: HTMLElement): void {
  for (const type of ["mousedown", "mouseup", "click"] as const) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }));
  }
}

/** Rendered (laid out, or `position: fixed`), and not inside a `[hidden]` / `aria-hidden` subtree. */
export function isShown(el: Element | null | undefined): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[hidden], [aria-hidden='true']")) return false;
  return el.offsetParent !== null || getComputedStyle(el).position === "fixed";
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
