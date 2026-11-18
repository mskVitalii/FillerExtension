import type { Profile } from "@/types/profile";
import type { AtsAdapter } from "./types";
import { clickLikeUser, inSectionHeaded, isShown, sleep, textOf, withoutRequiredMarker } from "./shared";
import { typeSearchText, fillElement } from "../native-setter";
import { pickLocationOption } from "../location";

/**
 * Lever (jobs.lever.co / jobs.eu.lever.co `/<company>/<id>/apply`). A server-rendered form of
 * `li.application-question` rows; what the generic engine can't see:
 *
 * - Custom "cards" put the question in `.application-label .text`, not in a `<label>` of the
 *   field — given as the field's label here, so e.g. "Was ist deine etwaige Gehaltsvorstellung?"
 *   is recognised as the salary field and an "Acknowledged" box carries the statement it
 *   acknowledges.
 * - "Current location" is a typeahead of `.dropdown-location` rows (no ARIA roles), results like
 *   "Berlin, DEU"; picking one also fills the hidden `selectedLocation`.
 * - The US EEO block (`eeo[gender|race|veteran]`) and "Demographic Survey" cards
 *   (`surveysResponses[…]`) are voluntary and stay unanswered.
 * - "Additional information" (`comments`) is where Lever expects a cover letter as text.
 * - The CV slot is `#resume-upload-input`; a cover letter can only be uploaded where the posting
 *   added a file card for it.
 */

const COVER_LETTER_RE = /cover[\s_-]?letter|motivation|anschreiben/i;
const DEMOGRAPHIC_NAME_RE = /^(eeo\[|surveysResponses\[)/;
const LOCATION_POLL_MS = 100;
const LOCATION_TIMEOUT_MS = 3000;

function questionRow(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>(".application-question");
}

function questionTitle(row: HTMLElement): string {
  const label = row.querySelector(".application-label");
  return withoutRequiredMarker(textOf(label?.querySelector(".text") ?? label));
}

function isLocationInput(el: HTMLElement): boolean {
  return el instanceof HTMLInputElement && (el.id === "location-input" || el.name === "location");
}

/**
 * Lever's "Current location" typeahead: types the city, waits for its `.dropdown-location` rows
 * and clicks the one in the applicant's country.
 */
async function fillLocation(el: HTMLInputElement, profile: Profile): Promise<boolean> {
  if (!profile.city) return false;
  typeSearchText(el, profile.city);
  const scope = el.closest(".application-field") ?? el.ownerDocument;
  for (let waited = 0; waited <= LOCATION_TIMEOUT_MS; waited += LOCATION_POLL_MS) {
    await sleep(waited === 0 ? 0 : LOCATION_POLL_MS);
    const rows = Array.from(scope.querySelectorAll<HTMLElement>(".dropdown-location")).filter(isShown);
    if (rows.length === 0) continue;
    const texts = rows.map((r) => textOf(r));
    const chosen = pickLocationOption(texts, profile.city, profile.country);
    if (!chosen) continue;
    clickLikeUser(rows[texts.indexOf(chosen)]);
    return true;
  }
  // No suggestion in the applicant's country: keep the city as typed text (the visible field
  // is a plain text input, `selectedLocation` just stays empty).
  return fillElement(el, profile.city);
}

export const lever: AtsAdapter = {
  id: "lever",

  detect(url, doc) {
    if (/(^|\.)lever\.co$/.test(url.hostname)) return true;
    return doc.querySelector('form#application-form [data-qa="btn-submit"], form#application-form input#resume-upload-input') !== null;
  },

  fieldLabel(el) {
    if (el instanceof HTMLTextAreaElement && el.name === "comments") {
      const hint = el.getAttribute("placeholder") ?? "";
      return `Additional information${hint ? ` — ${hint}` : ""} (cover letter or anything else to add)`;
    }
    const row = questionRow(el);
    return row ? questionTitle(row) || null : null;
  },

  isIgnored(el) {
    if (DEMOGRAPHIC_NAME_RE.test(el.getAttribute("name") ?? "")) return true;
    return inSectionHeaded(el, ".section", "h4");
  },

  mapField(el) {
    return isLocationInput(el) ? "city" : undefined;
  },

  fillField(el, field, _value, profile) {
    return field === "city" && isLocationInput(el) ? fillLocation(el as HTMLInputElement, profile) : undefined;
  },

  fileInputs(doc, kind) {
    const cv = doc.querySelector<HTMLInputElement>('input[type="file"]#resume-upload-input, input[type="file"][name="resume"]');
    if (kind === "cv") return cv ? [cv] : undefined;
    const card = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]')).find((input) => {
      if (input === cv) return false;
      const row = questionRow(input);
      const cardName = input.closest('[data-qa="additional-cards"]')?.querySelector('[data-qa="card-name"]');
      return COVER_LETTER_RE.test(row ? questionTitle(row) : "") || COVER_LETTER_RE.test(textOf(cardName));
    });
    if (card) return [card];
    return cv ? [] : undefined;
  },
};
