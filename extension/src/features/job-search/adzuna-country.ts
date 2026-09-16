import { countryNameToIso2 } from "@/lib/country-codes";

/**
 * Adzuna's supported markets (https://developer.adzuna.com/docs/search) —
 * an ISO-3166 alpha-2 allowlist, not a name table: `countryNameToIso2`
 * (`lib/country-codes.ts`) already resolves any of the ~195 English country
 * names `Profile.country` can hold (via `Intl.DisplayNames` + an overrides
 * table) to its ISO2 code, which is exactly Adzuna's `{country}` path
 * segment lowercased. A hand-written name→code table here would just be a
 * second, narrower copy of that same mapping — and a worse one, since any
 * profile country it didn't happen to list would silently fall back to
 * "us" even when Adzuna *does* support it. This still needs an allowlist
 * of its own, though: `countryNameToIso2` resolves far more countries than
 * Adzuna actually indexes, and asking for an unsupported one would 400.
 */
const ADZUNA_SUPPORTED_CODES = new Set([
  "AT",
  "AU",
  "BE",
  "BR",
  "CA",
  "CH",
  "DE",
  "ES",
  "FR",
  "GB",
  "IN",
  "IT",
  "MX",
  "NL",
  "NZ",
  "PL",
  "RU",
  "SG",
  "US",
  "ZA",
]);

export function adzunaCountryCode(profileCountry: string): string {
  const iso2 = countryNameToIso2(profileCountry)?.toUpperCase();
  return iso2 && ADZUNA_SUPPORTED_CODES.has(iso2) ? iso2.toLowerCase() : "us";
}
