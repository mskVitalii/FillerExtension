import { getCountries, type CountryCode } from "libphonenumber-js/min";

/**
 * The profile stores Country as an English short name (see lib/countries.ts),
 * but application forms label the same country every possible way — a
 * `<select>` of ISO codes, "Deutschland" instead of "Germany", French/Spanish
 * names on a localized site. These helpers bridge the stored English name to
 * an ISO-3166 alpha-2 code and back out to the other spellings a page might
 * use, so the country field can be matched regardless of the site's language.
 */

/** English names whose spelling differs from `Intl.DisplayNames(['en'])`'s output. */
const ENGLISH_NAME_OVERRIDES: Record<string, CountryCode> = {
  "united states": "US",
  "united kingdom": "GB",
  russia: "RU",
  "south korea": "KR",
  "north korea": "KP",
  "ivory coast": "CI",
  "cape verde": "CV",
  "vatican city": "VA",
  "east timor": "TL",
  "timor-leste": "TL",
  eswatini: "SZ",
  swaziland: "SZ",
  czechia: "CZ",
  "czech republic": "CZ",
  turkey: "TR",
  "türkiye": "TR",
  syria: "SY",
  laos: "LA",
  brunei: "BN",
  "cape verde islands": "CV",
  moldova: "MD",
  "north macedonia": "MK",
  macedonia: "MK",
  "democratic republic of the congo": "CD",
  "republic of the congo": "CG",
  congo: "CG",
};

let nameToIso2Cache: Map<string, string> | null = null;

function buildNameToIso2(): Map<string, string> {
  const map = new Map<string, string>();
  const english = safeDisplayNames("en");
  for (const code of getCountries()) {
    const name = english?.of(code);
    if (name) map.set(name.toLowerCase(), code);
  }
  for (const [name, code] of Object.entries(ENGLISH_NAME_OVERRIDES)) {
    map.set(name, code);
  }
  return map;
}

function safeDisplayNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    return null;
  }
}

/** English country name → ISO 3166-1 alpha-2 (e.g. "Germany" → "DE"), or null. */
export function countryNameToIso2(name: string): string | null {
  const key = name.trim().toLowerCase();
  if (!key) return null;
  if (ENGLISH_NAME_OVERRIDES[key]) return ENGLISH_NAME_OVERRIDES[key];
  nameToIso2Cache ??= buildNameToIso2();
  return nameToIso2Cache.get(key) ?? null;
}

const LOCALIZED_NAME_LOCALES = ["en", "de", "fr", "es", "it", "nl", "pt", "pl", "uk", "ru"];

/**
 * Every string a country `<select>`/input might use for the given English
 * name: localized names in common ATS languages plus the raw ISO codes.
 * Order is significant — earlier entries are tried first when matching.
 */
export function countryCandidates(englishName: string): string[] {
  const trimmed = englishName.trim();
  if (!trimmed) return [];

  const iso2 = countryNameToIso2(trimmed);
  const out = [trimmed];
  if (iso2) {
    for (const locale of LOCALIZED_NAME_LOCALES) {
      const localized = safeDisplayNames(locale)?.of(iso2 as CountryCode);
      if (localized) out.push(localized);
    }
    out.push(iso2, iso2.toLowerCase());
  }
  return [...new Set(out)];
}
