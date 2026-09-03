import {
  parsePhoneNumberFromString,
  getCountryCallingCode,
  type CountryCode,
  type PhoneNumber,
} from "libphonenumber-js/min";
import { countryNameToIso2 } from "./country-codes";

/**
 * Every rendering of one phone number a form might ask for, derived once
 * from a single canonical value so the autofill engine can pick whichever
 * shape a given field wants (spec: the same +49 number shows up as
 * `+491701234567`, `0170 1234567`, `1701234567` next to a separate dial-code
 * field, etc.).
 */
export interface ResolvedPhone {
  /** `+491701234567` — no spaces, always valid, the safe default. */
  e164: string;
  /** `+49 170 1234567` — grouped, human-readable international form. */
  international: string;
  /** `0170 1234567` — national form with the trunk prefix, grouped. */
  national: string;
  /** `01701234567` — national form with the trunk prefix, digits only. */
  nationalDigits: string;
  /** `1701234567` — national significant number, no trunk `0`, no country code. */
  significant: string;
  /** `49` — country calling code without the `+`. */
  callingCode: string;
  /** `DE` — ISO 3166-1 alpha-2, when the parser could determine it. */
  iso2: string | null;
}

/**
 * Parses a stored phone string into a {@link PhoneNumber}. `regionHint`
 * (an English country name, e.g. the profile's Country) lets a number typed
 * without a `+` (`0170…`) still resolve; a number that already carries `+`
 * ignores the hint.
 */
export function parsePhone(raw: string, regionHint?: string): PhoneNumber | undefined {
  const value = raw.trim();
  if (!value) return undefined;

  const region = regionHint ? countryNameToIso2(regionHint) : null;
  const parsed = parsePhoneNumberFromString(value, (region ?? undefined) as CountryCode | undefined);
  if (parsed?.isValid()) return parsed;

  // Retry without the region hint — covers values that are already E.164
  // but were paired with a mismatched Country in the profile.
  const bare = parsePhoneNumberFromString(value);
  return bare?.isValid() ? bare : undefined;
}

export function resolvePhone(raw: string, regionHint?: string): ResolvedPhone | null {
  const parsed = parsePhone(raw, regionHint);
  if (!parsed) return null;

  const national = parsed.formatNational();
  return {
    e164: parsed.number,
    international: parsed.formatInternational(),
    national,
    nationalDigits: national.replace(/\D/g, ""),
    significant: String(parsed.nationalNumber),
    callingCode: String(parsed.countryCallingCode),
    iso2: parsed.country ?? null,
  };
}

/** Canonical E.164 form for storage, or the trimmed input unchanged if it can't be parsed. */
export function canonicalPhone(raw: string, regionHint?: string): string {
  return parsePhone(raw, regionHint)?.number ?? raw.trim();
}

/** Dial code for an English country name (e.g. "Germany" → "49"), or null. */
export function callingCodeForCountry(countryName: string): string | null {
  const iso2 = countryNameToIso2(countryName);
  if (!iso2) return null;
  try {
    return getCountryCallingCode(iso2 as CountryCode);
  } catch {
    return null;
  }
}
