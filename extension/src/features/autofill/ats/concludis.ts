import type { AtsAdapter } from "./types";

/**
 * concludis (`<tenant>.concludis.de`). The posting is `/prj/shw/<hash>/<id>/<slug>.htm`; its
 * "Online bewerben" goes to `/bewerber/landingpage.php?prj=…`, which redirects to the form at
 * `/candidate/formapply`. The form has steps ("Pers. Angaben" → "Dokumente"/"Absenden"): the
 * privacy consent, preferred locations and the referral question only appear after "Weiter".
 * Documents go into one hidden multi-file upload (`uploadfile`, a plupload input).
 * Everything on the form is plain HTML and handled generically (salary amount + currency +
 * period selects, "PLZ, Ort" as two inputs under one label, start date as radios).
 */
export const concludis: AtsAdapter = {
  id: "concludis",
  detect(url, doc) {
    if (/(^|\.)concludis\.de$/.test(url.hostname)) return true;
    return doc.querySelector('form#concludis_apply_form, form[action*="/candidate/formapply"]') !== null;
  },
  formEntry(url, doc) {
    if (url.pathname.startsWith("/candidate/formapply")) return null;
    const link = doc.querySelector<HTMLAnchorElement>('a[href*="/bewerber/landingpage.php"], a[href*="/candidate/formapply"]');
    return link ? { url: new URL(link.getAttribute("href") ?? "", url).href, click: link } : null;
  },
  nextStep(doc) {
    const current = doc.querySelector(".form-section.current");
    const sections = Array.from(doc.querySelectorAll(".form-section"));
    if (!current || sections.indexOf(current) === sections.length - 1) return null;
    return doc.querySelector<HTMLElement>(".idealsteps-nav-buttons button.next, .form-navigation button.next");
  },
};
