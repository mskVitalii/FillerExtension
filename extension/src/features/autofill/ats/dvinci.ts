import type { AtsAdapter } from "./types";

/**
 * d.vinci (`<tenant>.dvinci-hr.com`, `dvinci-easy.com`, or a company domain "powered by
 * d.vinci"). The posting's "Bewerben" leads to `/jobs/<id>/intro`, a chooser (form / XING /
 * LinkedIn / "Lebenslauf hochladen" via Textkernel), and the form itself is `/jobs/<id>/form`.
 * Its one "Vollständige Bewerbungsunterlagen" upload (`.dvinci-upload`, `data-max-uploads` up to
 * 20) sends each chosen file at once and lists it, so CV and cover letter both go there.
 */
export const dvinci: AtsAdapter = {
  id: "dvinci",
  detect(url, doc) {
    if (/(^|\.)dvinci(-hr|-easy)?\.(com|de)$/.test(url.hostname)) return true;
    return doc.querySelector('#portalPoweredBy a[href*="dvinci"], .dvinci-upload, form[action*="/applicationForm/save"]') !== null;
  },
  fileSlots(input) {
    const upload = input.closest<HTMLElement>(".dvinci-upload");
    if (!upload) return undefined;
    const property = upload.dataset.property ?? "";
    if (property === "photoId") return ["photo"];
    if (property === "attachmentIds") return ["documents", "cv", "coverLetter"];
    return undefined;
  },
  appendsUploads(input) {
    const max = Number(input.closest<HTMLElement>(".dvinci-upload")?.dataset.maxUploads ?? "1");
    return max > 1;
  },
  formEntry(url, doc) {
    if (/\/jobs\/\d+\/form\/?$/.test(url.pathname)) return null;
    const link = doc.querySelector<HTMLAnchorElement>('a[href$="/form"], a[href*="/jobs/"][href$="/apply"]');
    if (link) return { url: new URL(link.getAttribute("href")!, url).href, click: link };
    const m = /^(.*\/jobs\/\d+)(?:\/[^/]*)?\/?$/.exec(url.pathname);
    return m ? { url: new URL(`${m[1]}/form`, url).href } : null;
  },
};
