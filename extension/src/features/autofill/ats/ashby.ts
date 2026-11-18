import type { AtsAdapter } from "./index";
import { inSectionHeaded } from "./index";
import { hostOf, textOf } from "./util";

/**
 * Ashby (jobs.ashbyhq.com/<org>/<id>/application, also embedded). A React form of
 * `[data-field-path]` entries with a `.ashby-application-form-question-title` each; what the
 * generic engine can't see:
 *
 * - "Autofill from resume" (`.ashby-application-form-autofill-input-root`) is a second file input
 *   that parses the upload and overwrites the name/email/phone/links already filled. The CV goes
 *   into the Resume field (`#_systemfield_resume`) only; the parser is never fed.
 * - The Location system field (`_systemfield_location`) has no `<label for>` of its own and may
 *   be relabelled ("What would be your preferred main location…?"); it's a geocoder typeahead
 *   (`role="combobox"`, results "Berlin, Germany"), filled by `location.ts`.
 * - Questions answered with a checkbox group (one checkbox per option, each with its own name)
 *   are option questions, not consent; the data-consent box ("I agree") takes its statement
 *   from the entry's description.
 * - A "Diversity Survey" / EEO section is voluntary and stays unanswered.
 */

const ENTRY_SELECTOR = "[data-field-path]";

function entryOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(ENTRY_SELECTOR);
}

export const ashby: AtsAdapter = {
  name: "ashby",

  detect(url, doc) {
    if (/(^|\.)ashbyhq\.com$/.test(hostOf(url))) return true;
    return doc.querySelector(".ashby-application-form-field-entry, .ashby-application-form-container") !== null;
  },

  fieldLabel(el) {
    const entry = entryOf(el);
    if (!entry) return null;
    const title = textOf(entry.querySelector(".ashby-application-form-question-title"));
    if (title) return title;
    return textOf(entry.querySelector(".ashby-application-form-question-description")).slice(0, 300) || null;
  },

  isExcluded(el) {
    if (el.closest(".ashby-application-form-autofill-uploader, .ashby-application-form-autofill-input-root")) return true;
    return inSectionHeaded(el, ".ashby-application-form-section-container", ".ashby-application-form-section-header-title");
  },

  isChoiceOption(el) {
    if (!(el instanceof HTMLInputElement) || el.type !== "checkbox") return false;
    const group = el.closest("fieldset") ?? entryOf(el);
    return (group?.querySelectorAll('input[type="checkbox"]').length ?? 0) >= 2;
  },

  isLocationField(el) {
    return el instanceof HTMLInputElement && el.closest('[data-field-path="_systemfield_location"]') !== null;
  },

  fileInput(kind, doc) {
    if (kind !== "cv") return undefined;
    return doc.querySelector<HTMLInputElement>('input[type="file"]#_systemfield_resume') ?? undefined;
  },
};
