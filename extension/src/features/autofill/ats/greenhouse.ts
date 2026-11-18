import type { AtsAdapter } from "./index";
import { hostOf } from "./util";

/**
 * Greenhouse: job-boards.greenhouse.io (and the EU instance job-boards.eu.greenhouse.io), the
 * legacy boards.greenhouse.io, and the `grnhse_iframe` embed — which now loads the same React
 * form from job-boards.greenhouse.io/embed/job_app, so the content script sees it inside that
 * frame. Most of the form is handled generically (labels are proper `<label for>`, dropdowns are
 * react-select, the phone has a react-select dial-code picker); what's Greenhouse-specific:
 *
 * - The optional demographic block (`#demographic-section` — "The Best Team Wins", gender
 *   identity…) and the US EEOC block stay unanswered, including the "store my answers" consent.
 * - Its CV and cover-letter slots are `#resume` / `#cover_letter`; a form without the latter has
 *   no cover-letter upload at all.
 */

const DEMOGRAPHIC_RE = /demographic|eeoc/i;

function inDemographicBlock(el: HTMLElement): boolean {
  if (DEMOGRAPHIC_RE.test(el.getAttribute("name") ?? "") || DEMOGRAPHIC_RE.test(el.id)) return true;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (DEMOGRAPHIC_RE.test(node.id) || DEMOGRAPHIC_RE.test(typeof node.className === "string" ? node.className : "")) return true;
  }
  return false;
}

function fileSlot(doc: Document, id: string, legacyName: string): HTMLInputElement | null {
  return (
    doc.querySelector<HTMLInputElement>(`input[type="file"]#${id}`) ??
    doc.querySelector<HTMLInputElement>(`input[type="file"][name="job_application[${legacyName}]"]`) ??
    doc.querySelector<HTMLInputElement>(`#${id}_fieldset input[type="file"]`)
  );
}

export const greenhouse: AtsAdapter = {
  name: "greenhouse",

  detect(url, doc) {
    if (/(^|\.)greenhouse\.io$/.test(hostOf(url))) return true;
    return doc.querySelector("form#application-form.application--form, form#application_form") !== null;
  },

  isExcluded: inDemographicBlock,

  fileInput(kind, doc) {
    const cv = fileSlot(doc, "resume", "resume");
    if (kind === "cv") return cv ?? undefined;
    const letter = fileSlot(doc, "cover_letter", "cover_letter");
    if (letter) return letter;
    return cv ? null : undefined;
  },
};
