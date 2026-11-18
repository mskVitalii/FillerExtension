import type { AtsAdapter } from "./types";

/**
 * Personio job pages (`<company>.jobs.personio.de|com/job/<id>/apply`): a single page with
 * fixed standard field names and employer-defined `custom_attribute_<id>` fields, one file
 * input per document category (`documents.cv`, `documents.cover-letter`,
 * `documents.employment-reference`, `documents.other`, …) and Cloudflare Turnstile on submit.
 *
 *  - `location` is the applicant's place of residence ("Ort" / "Location"), i.e. the city;
 *  - `gender` is a select (Male/Female/Diverse) — rendered from the profile's salutation;
 *  - without a cover-letter category, the cover letter goes to "Other" / "Andere".
 */
export const personio: AtsAdapter = {
  id: "personio",
  detect(url, doc) {
    if (/\.jobs\.personio\.(de|com)$/.test(url.hostname)) return true;
    return doc.querySelector('input[type="file"][id^="doc-input-"][name^="documents."]') !== null;
  },
  mapField(el) {
    const name = el.getAttribute("name");
    if (name === "location" && el instanceof HTMLInputElement) return "city";
    if (name === "gender" && el instanceof HTMLSelectElement) return "salutation";
    return undefined;
  },
  fallbackFileInput(kind, doc) {
    if (kind !== "coverLetter") return null;
    return doc.querySelector<HTMLInputElement>('input[type="file"][name="documents.other"]');
  },
  submitButton(doc) {
    return doc.querySelector<HTMLElement>('form button[type="submit"]');
  },
};
