import type { Profile } from "@/types/profile";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { ashby } from "./ashby";

/**
 * ATS-specific knowledge the generic engine can't infer from labels alone. Every hook is optional
 * and only consulted when `detect` recognised the current page; the generic path stays the
 * default for every other site. Keep adapters to facts about the ATS's own markup — anything
 * true of forms in general belongs in the engine itself.
 */
export interface AtsAdapter {
  name: string;
  /** True when `doc` (loaded from `url`) is this ATS's application form, embedded or not. */
  detect(url: string, doc: Document): boolean;
  /**
   * The ATS's own label for `el` when the generic label lookup can't reach it (a question title
   * that isn't a `<label for>` of the field). Used as one more label signal, never an identifier.
   */
  fieldLabel?(el: HTMLElement): string | null;
  /**
   * Fields every automatic pass (autofill, question scan, consent checkboxes, file upload) must
   * leave alone: a voluntary EEO / demographic survey (stays unanswered), a "parse my resume"
   * uploader that would overwrite what autofill typed.
   */
  isExcluded?(el: HTMLElement): boolean;
  /** True for a checkbox that is one option of a multiple-choice question, not a consent box. */
  isChoiceOption?(el: HTMLElement): boolean;
  /** Fills the applicant's location into the ATS's own location typeahead. */
  fillLocation?(el: HTMLElement, profile: Profile): Promise<boolean>;
  /** True for the ATS's location field (whatever its label says). */
  isLocationField?(el: HTMLElement): boolean;
  /**
   * The file input for a CV / cover letter: an element, `null` when this form has none (so the
   * generic "lone input" fallback mustn't fire), or `undefined` to defer to generic matching.
   */
  fileInput?(kind: "cv" | "coverLetter", doc: Document): HTMLInputElement | null | undefined;
}

export const ATS_ADAPTERS: AtsAdapter[] = [greenhouse, lever, ashby];

function currentUrl(doc: Document): string {
  try {
    return doc.location?.href ?? "";
  } catch {
    return "";
  }
}

/** The adapter for the page `doc` shows, or null on a non-ATS / unsupported page. */
export function activeAtsAdapter(doc: Document = document): AtsAdapter | null {
  const url = currentUrl(doc);
  return ATS_ADAPTERS.find((adapter) => adapter.detect(url, doc)) ?? null;
}

/** `activeAtsAdapter` for the document `el` lives in. */
export function atsAdapterFor(el: Element): AtsAdapter | null {
  return activeAtsAdapter(el.ownerDocument);
}

/** True when the page's adapter says automatic passes must skip `el`. */
export function isAtsExcluded(el: HTMLElement): boolean {
  return atsAdapterFor(el)?.isExcluded?.(el) ?? false;
}

/** The page adapter's own label for `el`, or "". */
export function atsFieldLabel(el: HTMLElement): string {
  return atsAdapterFor(el)?.fieldLabel?.(el)?.replace(/\s+/g, " ").trim() ?? "";
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
