import type { AtsAdapter } from "./types";

/**
 * SmartRecruiters — postings on `jobs.smartrecruiters.com/<Company>/<id>-<slug>` or a company
 * careers site (Delivery Hero: `careers.deliveryhero.com/job/…-jid-<n>`, whose "Apply" opens
 * `/Workflow?workflowId=…&vacancyId=…`, which redirects to SmartRecruiters' one-click form,
 * `jobs.smartrecruiters.com/oneclick-ui/company/<Company>/publication/<uuid>`).
 *
 * The one-click form sits behind DataDome bot protection: an automated browser gets a captcha
 * (`geo.captcha-delivery.com`) instead of the form, which Filler never tries to get past — so no
 * snapshot of the form itself is in `test/ats/smartrecruiters/` yet, and only the way *to* the
 * form is handled here.
 */
export const smartrecruiters: AtsAdapter = {
  id: "smartrecruiters",
  detect(url, doc) {
    if (/(^|\.)smartrecruiters\.com$/.test(url.hostname)) return true;
    return doc.querySelector('a[href*="/Workflow?workflowId="], a[href*="smartrecruiters.com/oneclick-ui/"]') !== null;
  },
  formEntry(url, doc) {
    if (url.pathname.includes("/oneclick-ui/")) return null;
    const link = doc.querySelector<HTMLAnchorElement>(
      'a[href*="/oneclick-ui/"], a[href*="/Workflow?workflowId="], a#st-apply, a[data-test="apply-button"]',
    );
    return link ? { url: new URL(link.getAttribute("href") ?? "", url).href, click: link } : null;
  },
};
