import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getPreferences } from "@/features/storage/sync";
import { resolveLocale, translate, type Locale, type Translate, type UiLanguagePreference } from "./core";

interface I18nValue {
  locale: Locale;
  t: Translate;
  /** Applies a new preference right away (Settings saves it to sync storage itself). */
  setPreference: (preference: UiLanguagePreference) => void;
}

const browserLanguages = (): readonly string[] =>
  typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];

const fallbackLocale = resolveLocale("auto", browserLanguages());
const I18nContext = createContext<I18nValue>({
  locale: fallbackLocale,
  t: (key, vars) => translate(fallbackLocale, key, vars),
  setPreference: () => undefined,
});

/** Picks the locale from the stored preference (or the browser's languages) and keeps `<html lang>` in step. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<UiLanguagePreference>("auto");

  useEffect(() => {
    void getPreferences().then((prefs) => setPreference(prefs.uiLanguage));
    // Another panel (another window) changed it.
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const next = (changes.preferences?.newValue as { uiLanguage?: UiLanguagePreference } | undefined)?.uiLanguage;
      if (area === "sync" && next) setPreference(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const locale = resolveLocale(preference, browserLanguages());
    return { locale, t: (key, vars) => translate(locale, key, vars), setPreference };
  }, [preference]);

  useEffect(() => {
    document.documentElement.lang = value.locale;
  }, [value.locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hooks belong with their provider
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

/** The translate function for the current UI language. */
// eslint-disable-next-line react-refresh/only-export-components -- the hooks belong with their provider
export function useT(): Translate {
  return useContext(I18nContext).t;
}
