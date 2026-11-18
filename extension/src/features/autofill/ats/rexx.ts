import type { AtsAdapter } from "./types";

/**
 * rexx systems (`<tenant>-portal.rexx-recruitment.com`, `*.rexx-systems.com`, or a company
 * careers page serving rexx's `bewerbung_form`). The posting is `…-de-j<id>.html`, the form
 * `…-de-f<id>.html`. Its selects are jQuery UI selectmenus over hidden native selects
 * (`select-facade.ts`), its consent is a hidden checkbox with a styled label, and every form
 * ends with an `aria-hidden` "Website" honeypot (`honeypot.ts`) — all handled generically.
 * Specific here: the `cv_lebenslauf` upload at the top is rexx's CV *parser* (it prefills the
 * form), never the CV attachment, which is the separate "Lebenslauf" / "Komplette Unterlagen"
 * upload further down.
 */
export const rexx: AtsAdapter = {
  id: "rexx",
  detect(url, doc) {
    if (/(^|\.)rexx-(recruitment|systems)\.com$/.test(url.hostname)) return true;
    return doc.querySelector('form[name="bewerbung_form"], #rexx_footer, form.rexxcha') !== null;
  },
  fileSlots(input) {
    if (input.name === "cv_lebenslauf" || input.closest("#cvparser")) return ["parser"];
    return undefined;
  },
  formEntry(url, doc) {
    if (/-f\d+\.html$/.test(url.pathname)) return null;
    const link = doc.querySelector<HTMLAnchorElement>('a[href*="-f"][href$=".html"], a[href*="-f"][href*=".html?"]');
    const href = link ? new URL(link.getAttribute("href") ?? "", url).href : "";
    if (link && /-f\d+\.html/.test(href)) return { url: href, click: link };
    const m = /^(.*)-j(\d+)\.html$/.exec(url.pathname);
    return m ? { url: new URL(`${m[1]}-f${m[2]}.html`, url).href } : null;
  },
};
