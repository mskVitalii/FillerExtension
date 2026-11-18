import type { AtsAdapter } from "./types";
import { buttonByText } from "./shared";

/**
 * softgarden (`<company>.career.softgarden.de/application/…`, `*.softgarden.io`): a three-step
 * widget on one page — CV and attachments, personal data, additional questions — where each
 * "zum nächsten Schritt" reveals the next step below the previous ones. The final step ends in
 * a Friendly Captcha and "Bestätigen"/"Submit". Privacy is a link, not a checkbox.
 *
 * What the generic engine needs to know:
 *  - there is no cover-letter upload slot: the cover letter goes into "Weitere Anhänge"
 *    (`attachments`), as the form itself suggests ("Alternativ kann das Anschreiben als Anhang
 *    hochgeladen werden");
 *  - the steps are advanced by buttons, never by submitting.
 * Ghost inputs (`resumeUploaded`, `allowApplied`, aria-hidden) and the pick lists' read-only
 * inputs are handled generically.
 */
export const softgarden: AtsAdapter = {
  id: "softgarden",
  detect(url, doc) {
    const host = url.hostname;
    if (/(^|\.)softgarden\.(io|de)$/.test(host) && /\/application\//.test(url.pathname)) return true;
    // The widget's own field names, for an application served from the employer's domain.
    return doc.querySelector('input[type="file"][name="cv-file"], form [name^="applicationData."]') !== null;
  },
  fallbackFileInput(kind, doc) {
    if (kind !== "coverLetter") return null;
    const input = doc.querySelector<HTMLInputElement>('input[type="file"][name="attachments"]');
    return input && !input.disabled ? input : null;
  },
  nextStep(doc) {
    return buttonByText(doc, /^(zum nächsten schritt|zum letzten schritt|to the next step|to the last step)$/i);
  },
  submitButton(doc) {
    return doc.querySelector<HTMLElement>('[data-widget="application"] button[type="submit"]');
  },
};
