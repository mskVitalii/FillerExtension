/**
 * Anti-spam honeypots: a text field real users never see or reach, which bots fill and the
 * server then rejects the submission for (rexx: `<div aria-hidden="true" tabindex="-1"><label
 * for="website">Website</label><input name="website" tabindex="-1" autocomplete="off"></div>` at
 * the end of every application form — its "Website" label matched the profile's website). Only
 * text-like fields count: a native `<select>` hidden from assistive tech under a select2 facade
 * (also `aria-hidden="true"`) is a real field, filled through that facade.
 */
const HONEYPOT_NAME_RE = /honeypot|hpot|\bhp[_-]|bot[_-]?trap|leave[_-]?(this[_-]?)?(blank|empty)|do[_-]?not[_-]?fill/i;

export function isHoneypot(el: HTMLElement): boolean {
  const textLike = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "file");
  if (!textLike) return false;
  if (el.closest('[aria-hidden="true"]')) return true;
  const name = `${el.getAttribute("name") ?? ""} ${el.id} ${el.className}`;
  return HONEYPOT_NAME_RE.test(name);
}
