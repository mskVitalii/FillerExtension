import { en, type MessageKey } from "./messages/en";
import { de } from "./messages/de";
import { ru } from "./messages/ru";

/**
 * The Side Panel's UI language. A typed dictionary rather than
 * `chrome.i18n`/`_locales`: `chrome.i18n.getMessage` always follows the
 * browser's UI language and can't be switched at runtime, and Settings has
 * a manual override. `en` is the source of truth — `de`/`ru` are typed
 * `Record<MessageKey, string>`, so a missing translation fails typecheck.
 */

export const LOCALES = ["en", "de", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
/** Stored preference: a locale, or "auto" (the browser's language). */
export type UiLanguagePreference = Locale | "auto";

export const LOCALE_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", ru: "Русский" };

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, de, ru };

/** First of the browser's preferred languages Filler speaks, else English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if ((LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return "en";
}

export function resolveLocale(preference: UiLanguagePreference | undefined, languages: readonly string[]): Locale {
  return preference && preference !== "auto" ? preference : detectLocale(languages);
}

export type Vars = Record<string, string | number>;

/** `{name}` placeholders are replaced from `vars`; an unknown key falls back to English, then to the key. */
export function translate(locale: Locale, key: MessageKey, vars?: Vars): string {
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export type Translate = (key: MessageKey, vars?: Vars) => string;
export type { MessageKey };

/** "de" → "Deutsch" / "German" / "немецкий", in the UI language (falls back to the code). */
export function displayLanguage(locale: Locale, code: string | null | undefined): string {
  if (!code) return "";
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code) ?? code;
    return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    return code;
  }
}
