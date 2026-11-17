import { LANGUAGES } from "./languages";

/**
 * ISO 639-1 codes for the languages a CV can be written in. Stored on
 * `CvMeta.language` as the code (stable, what the export format promises),
 * shown to the user by name.
 */
export const LANGUAGE_CODES: Record<(typeof LANGUAGES)[number], string> = {
  Russian: "ru",
  English: "en",
  German: "de",
  Ukrainian: "uk",
  Spanish: "es",
  French: "fr",
  Polish: "pl",
  Portuguese: "pt",
  Italian: "it",
  Turkish: "tr",
  Chinese: "zh",
  Japanese: "ja",
};

/** The language options a CV can be tagged with, by code, in `LANGUAGES` order. */
export const CV_LANGUAGE_OPTIONS = LANGUAGES.map((name) => ({ code: LANGUAGE_CODES[name], name }));

/** "German", "german", "Deutsch", "de", "de-DE" → "de"; null when unknown. */
export function languageCode(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  const base = text.split(/[-_]/)[0];
  if (Object.values(LANGUAGE_CODES).includes(base)) return base;
  for (const [name, code] of Object.entries(LANGUAGE_CODES)) if (name.toLowerCase() === text) return code;
  const native: Record<string, string> = { deutsch: "de", englisch: "en", русский: "ru", français: "fr", español: "es" };
  return native[text] ?? null;
}

export function languageName(code: string | null | undefined): string {
  return CV_LANGUAGE_OPTIONS.find((option) => option.code === code)?.name ?? code ?? "";
}
