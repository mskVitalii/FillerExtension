/**
 * The profile keeps one salutation ("Ms", "Herr", …), but forms ask for it in their own words:
 * a German `<select>` offers "Frau"/"Herr"/"Divers", rexx's "Geschlecht" offers
 * "Weiblich"/"Männlich", an English Umantis form "Ms"/"Mr."/"Other", d.vinci stores `MS`/`MR`.
 * These are the spellings one salutation may appear under, matched against an option's text or
 * value (case-insensitive, trailing "." ignored).
 */
const SALUTATION_GROUPS: string[][] = [
  ["frau", "ms", "mrs", "miss", "madame", "mme", "female", "weiblich", "woman", "f", "gender_female"],
  ["herr", "mr", "monsieur", "male", "männlich", "maennlich", "man", "m", "gender_male"],
  ["divers", "mx", "diverse", "other", "neutral", "neutrale anrede", "nicht-binär", "non-binary", "d", "gender_diverse"],
];

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

/** Every spelling `value` may appear under on a form, `value` itself first. */
export function salutationCandidates(value: string): string[] {
  const wanted = norm(value);
  const group = SALUTATION_GROUPS.find((g) => g.includes(wanted));
  return group ? [value, ...group.filter((s) => s !== wanted)] : [value];
}

/** True when `label` is one of the salutation spellings `value` may appear under. */
export function salutationMatches(label: string, value: string): boolean {
  const wanted = salutationCandidates(value).map(norm);
  return wanted.includes(norm(label));
}

/** A radio group whose options are all salutation/gender words ("Frau / Herr / Divers"). */
export function looksLikeSalutationOptions(labels: string[]): boolean {
  if (labels.length < 2) return false;
  const all = SALUTATION_GROUPS.flat();
  const known = labels.filter((l) => all.includes(norm(l)) || /keine angabe|prefer not|ohne angabe/i.test(l));
  // Single letters ("m"/"f"/"d") only count as values, never as a reason to call a group a salutation.
  return known.length === labels.length && labels.some((l) => norm(l).length > 1);
}
