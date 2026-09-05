import type { ProfileFieldKey } from "@/types/profile";

/**
 * Signal → semantic field patterns (spec section 12). Deliberately
 * multi-language / multi-phrasing (e.g. "Vorname", "Given name",
 * "First Name *") since the extraction must stay generic across sites.
 */
export const FIELD_PATTERNS: Record<ProfileFieldKey, RegExp[]> = {
  salutation: [/salutation/i, /anrede/i, /^title$/i],
  pronouns: [/pronoun/i],
  firstName: [/first[\s_-]?name/i, /given[\s_-]?name/i, /vorname/i, /\bfname\b/i, /^first$/i],
  lastName: [/last[\s_-]?name/i, /family[\s_-]?name/i, /surname/i, /nachname/i, /\blname\b/i, /^last$/i],
  fullName: [/^full[\s_-]?name/i, /^name$/i, /your[\s_-]?name/i, /applicant[\s_-]?name/i],
  email: [/e-?mail/i],
  phone: [/phone/i, /mobile/i, /telefon/i, /tel\.?number/i, /\btel\b/i],
  // The email-guard on `address`/`adresse` must look *behind* as well as
  // ahead: "E-Mail Adresse" and a `name="…e_mail_address…"` attribute both
  // have "email" immediately *before* "address", not after — a
  // forward-only `(?!.*email)` lookahead never catches that (confirmed
  // live: that exact name attribute matched `address` before the `email`
  // signal (a separate, later-checked label) ever got a chance, filling a
  // street address into an email field). `e[-_\s]?mail` covers "email",
  // "e-mail" and the underscore-joined "e_mail" a `name`/`id` attribute
  // uses.
  address: [/(?<!e[-_\s]?mail[\s_-]*)address(?!.*e[-_\s]?mail)/i, /street/i, /(?<!e[-_\s]?mail[\s_-]*)adresse/i, /strasse|straße/i],
  // `(?<!w)ort\b` (not `\bort\b`) deliberately still matches compounds like
  // "Wohnort"/"Geburtsort" (residence/birthplace) that legitimately mean
  // "place" — but the negative lookbehind excludes anything ending in
  // "-wort" ("Kennwort", "Passwort", "Stichwort" = password/keyword), which
  // a plain `ort\b` used to false-positive on and (confirmed live against a
  // real SAP SuccessFactors form) was stuffing the profile's city into
  // password fields.
  city: [/\bcity\b/i, /town/i, /stadt/i, /(?<!w)ort\b/i],
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
    /gehaltserwartung/i,
  ],
};

export const FIELD_ORDER: ProfileFieldKey[] = Object.keys(FIELD_PATTERNS) as ProfileFieldKey[];
