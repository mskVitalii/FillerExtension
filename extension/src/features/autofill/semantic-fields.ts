import type { ProfileFieldKey } from "@/types/profile";

/**
 * Signal → semantic field patterns (spec section 12). Deliberately
 * multi-language / multi-phrasing (e.g. "Vorname", "Given name",
 * "First Name *") since the extraction must stay generic across sites.
 */
export const FIELD_PATTERNS: Record<ProfileFieldKey, RegExp[]> = {
  salutation: [/salutation/i, /anrede/i, /^title$/i],
  firstName: [/first[\s_-]?name/i, /given[\s_-]?name/i, /vorname/i, /\bfname\b/i, /^first$/i],
  lastName: [/last[\s_-]?name/i, /family[\s_-]?name/i, /surname/i, /nachname/i, /\blname\b/i, /^last$/i],
  fullName: [/^full[\s_-]?name/i, /^name$/i, /your[\s_-]?name/i, /applicant[\s_-]?name/i],
  email: [/e-?mail/i],
  phone: [/phone/i, /mobile/i, /telefon/i, /tel\.?number/i, /\btel\b/i],
  address: [/address(?!.*email)/i, /street/i, /adresse/i, /strasse|straße/i],
  city: [/\bcity\b/i, /town/i, /stadt/i, /ort\b/i],
  postalCode: [/postal[\s_-]?code/i, /zip/i, /plz/i],
  country: [/country/i, /land\b/i, /nation/i],
  linkedin: [/linkedin/i],
  github: [/github/i],
  website: [/website/i, /portfolio/i, /homepage/i, /personal[\s_-]?site/i],
  expectedSalary: [
    /desired[\s_-]?salary/i,
    /expected[\s_-]?salary/i,
    /salary[\s_-]?expectation/i,
    /expected[\s_-]?compensation/i,
    /desired[\s_-]?compensation/i,
    /compensation[\s_-]?expectation/i,
    /gehaltsvorstellung/i,
    /wunschgehalt/i,
  ],
};

export const FIELD_ORDER: ProfileFieldKey[] = Object.keys(FIELD_PATTERNS) as ProfileFieldKey[];
