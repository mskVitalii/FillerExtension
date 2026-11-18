import type { AtsAdapter } from "./index";
import { hostOf } from "./util";

/**
 * Recruitee / Tellent (`<company>.recruitee.com/o/<offer>/c/new`, or the employer's own careers
 * domain): one page. Standard fields are `candidate.name` (full name), `candidate.email`,
 * `candidate.phone` (with a dial-code combobox), `candidate.cv` and `candidate.coverLetterFile`;
 * employer questions are `candidate.openQuestionAnswers.<id>.{content,flag,multiContent,file}`.
 * The generic engine covers it; the adapter only identifies the form and its submit button.
 */
export const recruitee: AtsAdapter = {
  id: "recruitee",
  detect(url, doc) {
    if (/(^|\.)recruitee\.com$/.test(hostOf(url))) return true;
    return doc.querySelector('form#offer-application-form, form [name="candidate.cv"]') !== null;
  },
  submitButton(doc) {
    return doc.querySelector<HTMLElement>('[data-testid="submit-application-form-button"]');
  },
};
