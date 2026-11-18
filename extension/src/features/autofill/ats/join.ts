import type { AtsAdapter } from "./index";
import { buttonByText, hostOf } from "./util";

/**
 * join.com (`join.com/companies/<company>/<jobId>/apply/<step>`): an email gate
 * (`authentication`, reCAPTCHA v3) that logs into or creates a candidate account, then a wizard
 * with one screen per step (personal information with the CV, cover letter, salary, start date,
 * screening questions, links, review). Each screen is advanced by `[data-testid=ContinueButton]`
 * ("Weiter"); the last one sends. The account email is filled by JOIN and read-only.
 */
export const join: AtsAdapter = {
  id: "join",
  detect(url) {
    return /(^|\.)join\.com$/.test(hostOf(url)) && /\/companies\/[^/]+\/[^/]+\/apply(\/|$|\?)/.test(url);
  },
  nextStepButton(doc) {
    const button = doc.querySelector<HTMLElement>('[data-testid="ContinueButton"]');
    if (button) return button;
    return buttonByText(doc, /^(weiter|continue|next)$/i);
  },
  submitButton(doc) {
    return buttonByText(doc, /^(bewerbung (absenden|senden)|send application|submit application)$/i);
  },
};
