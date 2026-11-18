/**
 * The profile stores one salutation ("Ms", "Herr", …), but forms ask for it in their own
 * language and sometimes as a gender: German ATS (softgarden, Personio, d.vinci) offer
 * "Herr / Frau / Divers", Personio's `gender` select "Male / Female / Diverse", rexx's
 * "Geschlecht" "Männlich / Weiblich", an English Umantis form "Ms / Mr. / Other",
 * SuccessFactors "Ms." / "Mr.", d.vinci stores `MS` / `MR`, some selects `m` / `f` / `d`. These
 * are the spellings of the same answer, so an option can be matched whatever its language.
 * Matching is always case-insensitive; the casing below is only how the spellings read.
 */

type Group = "female" | "male" | "diverse";

const SPELLINGS: Record<Group, string[]> = {
  female: [
    "Frau", "Ms", "Ms.", "Mrs", "Mrs.", "Miss", "Mme", "Madame", "female", "weiblich", "woman", "Femme",
    "f", "gender_female",
  ],
  male: [
    "Herr", "Mr", "Mr.", "Mister", "Sir", "Monsieur", "M.", "male", "männlich", "maennlich", "man", "Homme",
    "m", "gender_male",
  ],
  diverse: [
    "Divers", "Diverse", "Mx", "Mx.", "neutral", "neutrale Anrede", "other", "non-binary", "nicht-binär",
    "nichtbinär", "non-binaire", "d", "gender_diverse",
  ],
};

/** Lower-cased, single-spaced, trailing "." dropped: "Mr." and "mr" are the same spelling. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "").trim();
}

function groupOf(value: string): Group | null {
  const wanted = norm(value);
  if (!wanted) return null;
  for (const group of Object.keys(SPELLINGS) as Group[]) {
    if (SPELLINGS[group].some((s) => norm(s) === wanted)) return group;
  }
  return null;
}

/**
 * `value` itself first, then every other spelling of the same salutation (each once, ignoring
 * case). A value this doesn't know (a title like "Dr.") yields just itself, so it's only ever
 * matched verbatim.
 */
export function salutationCandidates(value: string): string[] {
  const group = groupOf(value);
  const all = group ? [value, ...SPELLINGS[group]] : [value];
  const seen = new Set<string>();
  return all.filter((s) => {
    const key = s.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** True when `label` (an option's text or value) is one of the spellings `value` may appear under. */
export function salutationMatches(label: string, value: string): boolean {
  const wanted = norm(label);
  return wanted !== "" && salutationCandidates(value).some((s) => norm(s) === wanted);
}

const ALL_SPELLINGS = new Set(Object.values(SPELLINGS).flat().map(norm));

/** A radio group whose options are all salutation/gender words ("Frau / Herr / Divers"). */
export function looksLikeSalutationOptions(labels: string[]): boolean {
  if (labels.length < 2) return false;
  const known = labels.filter((l) => ALL_SPELLINGS.has(norm(l)) || /keine angabe|prefer not|ohne angabe/i.test(l));
  // Single letters ("m"/"f"/"d") only count as values, never as a reason to call a group a salutation.
  return known.length === labels.length && labels.some((l) => norm(l).length > 1);
}
