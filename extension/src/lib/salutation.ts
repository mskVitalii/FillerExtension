/**
 * The profile stores one salutation ("Ms", "Herr", …), but forms ask for it in their own
 * language and sometimes as a gender: German ATS (softgarden, Personio, d.vinci) offer
 * "Herr / Frau / Divers", Personio's `gender` select offers "Male / Female / Diverse". These
 * are the spellings of the same answer, so a select can be matched whatever its language.
 */

type Group = "female" | "male" | "diverse";

const SPELLINGS: Record<Group, string[]> = {
  female: ["Frau", "Ms", "Ms.", "Mrs", "Mrs.", "Miss", "Mme", "Madame", "Female", "Weiblich", "Woman", "Femme"],
  male: ["Herr", "Mr", "Mr.", "Monsieur", "M.", "Male", "Männlich", "Man", "Homme"],
  diverse: ["Divers", "Diverse", "Mx", "Mx.", "Non-binary", "Nichtbinär", "Nicht-binär", "Non-binaire"],
};

function groupOf(value: string): Group | null {
  const wanted = value.trim().toLowerCase();
  if (!wanted) return null;
  for (const group of Object.keys(SPELLINGS) as Group[]) {
    if (SPELLINGS[group].some((s) => s.toLowerCase() === wanted)) return group;
  }
  return null;
}

/**
 * `value` itself first, then every other spelling of the same salutation. A value this doesn't
 * know (a title like "Dr.") yields just itself, so it's only ever matched verbatim.
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
