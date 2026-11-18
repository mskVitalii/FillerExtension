import { countryCandidates, countryNameToIso2 } from "@/lib/country-codes";
import { fillComboboxBySearch, isComboboxLike } from "./combobox";
import { fillElement } from "./native-setter";

/**
 * Location typeaheads (Greenhouse "Location (City)", Ashby "Location", Lever "Current location"):
 * the field only takes a value picked from geocoder results, and a city name alone is ambiguous —
 * "Berlin" also lists Berlin, New Hampshire first. So the applicant's city is typed as the search
 * term and the result is chosen by city *and* country.
 */

/** ISO 3166-1 alpha-3 codes for the countries an ATS geocoder (Lever: "Berlin, DEU") is likely to show for this user base. */
const ISO3: Record<string, string> = {
  DE: "DEU", AT: "AUT", CH: "CHE", NL: "NLD", BE: "BEL", LU: "LUX", FR: "FRA", IT: "ITA", ES: "ESP", PT: "PRT",
  GB: "GBR", IE: "IRL", DK: "DNK", SE: "SWE", NO: "NOR", FI: "FIN", IS: "ISL", PL: "POL", CZ: "CZE", SK: "SVK",
  HU: "HUN", SI: "SVN", HR: "HRV", RO: "ROU", BG: "BGR", GR: "GRC", CY: "CYP", MT: "MLT", EE: "EST", LV: "LVA",
  LT: "LTU", UA: "UKR", RS: "SRB", BA: "BIH", AL: "ALB", MK: "MKD", ME: "MNE", MD: "MDA", BY: "BLR", RU: "RUS",
  TR: "TUR", US: "USA", CA: "CAN", MX: "MEX", BR: "BRA", AR: "ARG", IN: "IND", CN: "CHN", JP: "JPN", KR: "KOR",
  AU: "AUS", NZ: "NZL", IL: "ISR", AE: "ARE", ZA: "ZAF", SG: "SGP", EG: "EGY", NG: "NGA", KZ: "KAZ", GE: "GEO",
  AM: "ARM", AZ: "AZE", UZ: "UZB",
};

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** Every token a geocoder result might use for `country`: localized names, ISO-2 and ISO-3. */
function countryTokens(country: string): string[] {
  const iso2 = countryNameToIso2(country);
  const tokens = countryCandidates(country).map(norm);
  if (iso2 && ISO3[iso2]) tokens.push(norm(ISO3[iso2]));
  return [...new Set(tokens.filter(Boolean))];
}

/** True when `segment` (one comma-separated part of a result) names the country. */
function segmentIsCountry(segment: string, tokens: string[]): boolean {
  const s = norm(segment);
  return tokens.some((t) => s === t);
}

/**
 * The geocoder result that is the applicant's city in the applicant's country: its first
 * comma-separated part is the city, and (when a country is known) a later part names that
 * country. Null rather than a guess when the country is known but no result is in it.
 */
export function pickLocationOption(texts: string[], city: string, country: string): string | null {
  const c = norm(city);
  if (!c) return null;
  const cityMatches = texts.filter((t) => {
    const first = norm(t.split(",")[0] ?? "");
    return first === c || first.startsWith(`${c} `);
  });
  if (cityMatches.length === 0) return null;
  if (!country.trim()) return cityMatches[0];
  const tokens = countryTokens(country);
  const inCountry = cityMatches.find((t) => t.split(",").slice(1).some((seg) => segmentIsCountry(seg, tokens)));
  if (inCountry) return inCountry;
  // A result with no country part at all ("Berlin") is the city itself; one naming another country is not.
  return cityMatches.find((t) => !t.includes(",")) ?? null;
}

/**
 * Fills a location field from the profile: picks a geocoder result in a typeahead, types the city
 * into a plain text field.
 */
export async function fillLocationField(el: HTMLElement, city: string, country: string): Promise<boolean> {
  if (!city) return false;
  if (isComboboxLike(el)) {
    return fillComboboxBySearch(el, city, (texts) => pickLocationOption(texts, city, country));
  }
  return fillElement(el, city);
}
