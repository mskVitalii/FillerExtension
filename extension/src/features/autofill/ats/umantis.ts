import type { AtsAdapter } from "./types";

/**
 * Umantis / Abacus (Haufe) — `recruitingapp-<n>[.de].umantis.com`. The posting is
 * `/Vacancies/<id>/Description/<lang>`, "Bewerben" goes through `/Application/CheckLogin/<lang>`
 * to the form at `/Application/New/<lang>`. The form creates a candidate account on submit
 * ("E-Mail-Adresse/Login" + "Passwort"), so the engine's generated password ends up as that
 * account's password and is returned to the caller. Salutation is a radio group
 * (Frau/Herr/Divers, filled generically) and several "Weitere Dokumente" uploads take references.
 */
export const umantis: AtsAdapter = {
  id: "umantis",
  detect(url, doc) {
    if (/(^|\.)umantis\.com$/.test(url.hostname)) return true;
    return doc.querySelector('form[name="EditForm"][action*="/Vacancies/"]') !== null;
  },
  formEntry(url, doc) {
    if (/\/Application\/New\//.test(url.pathname)) return null;
    const link = doc.querySelector<HTMLAnchorElement>('a[href*="/Application/CheckLogin/"], a[href*="/Application/New/"]');
    if (link) return { url: new URL(link.getAttribute("href") ?? "", url).href, click: link };
    const m = /^\/Vacancies\/(\d+)\/Description\/(\d+)/.exec(url.pathname);
    return m ? { url: new URL(`/Vacancies/${m[1]}/Application/CheckLogin/${m[2]}`, url).href } : null;
  },
};
