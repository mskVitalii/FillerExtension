import type { ProfileFieldKey } from "@/types/profile";

/**
 * Signal → semantic field patterns (spec section 12). Deliberately
 * multi-language / multi-phrasing (e.g. "Vorname", "Given name",
 * "First Name *") since the extraction must stay generic across sites.
 */
export const FIELD_PATTERNS: Record<ProfileFieldKey, RegExp[]> = {
  // "Titel"/"Anredetitel" on a German form is the *academic* title (Dr., Prof.), never Mr/Ms —
  // `/^title$/` only counts on a choice field (`CHOICE_ONLY_PATTERNS` below), where it is the
  // English "Title: Mr/Ms/Mx" picker. "Geschlecht"/"gender" is asked instead of a salutation by
  // many German ATS (rexx: Männlich/Weiblich/Divers); the salutation's options map onto it.
  salutation: [/salutation/i, /anrede(?!titel)/i, /^title$/i, /geschlecht/i, /\bgender\b/i],
  pronouns: [/pronoun/i],
  firstName: [/first[\s_-]?name/i, /given[\s_-]?name/i, /vorname/i, /\bfname\b/i, /^first$/i],
  // "First and last name" (Ashby) / "Vor- und Nachname" ask for the *full* name: the lookbehinds
  // keep lastName (tested before fullName) from claiming them.
  lastName: [
    /(?<!first\s*(?:and|&|\/|\+)\s*)last[\s_-]?name/i,
    /family[\s_-]?name/i,
    /surname/i,
    /(?<!vor-?\s*(?:und|&|\/)\s*)nachname/i,
    /\blname\b/i,
    /^last$/i,
  ],
  fullName: [
    /^full[\s_-]?name/i,
    /^name$/i,
    /your[\s_-]?name/i,
    /applicant[\s_-]?name/i,
    /first\s*(?:and|&|\/|\+)\s*last\s*name/i,
    /vor-?\s*(?:und|&|\/)\s*nachname/i,
  ],
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
  // A bare "Location" / "Current location" / "Location (City)" field (Lever, Ashby, Greenhouse)
  // asks where the applicant lives — anchored, so a question merely *mentioning* a location
  // ("preferred work location?", "Are you willing to relocate?") never matches. `\bort\b` (a
  // word on its own: "Ort", "PLZ, Ort", `name="ort"`) plus "Wohnort" — not `ort\b` anywhere,
  // which matched "Kennwort"/"Passwort" (confirmed live on SAP SuccessFactors) and "Ab sofort"
  // (a concludis start-date radio).
  city: [
    /\bcity\b/i,
    /town/i,
    /stadt/i,
    /\bort\b/i,
    /wohnort/i,
    /^(?:current|your|home|candidate)?[\s_-]*location(?:[\s_-]*\(city\))?[\s*✱:]*$/i,
  ],
  postalCode: [/postal[\s_-]?code/i, /zip/i, /plz/i, /postleitzahl/i],
  // "Land" as a word or as the head of a compound ("Wohnsitzland", "Aufenthaltsland") — not any
  // word ending in -land: "Hast du eine Arbeitserlaubnis für Deutschland?" is a yes/no question,
  // and "Ausland" (rexx `erfahrung_ausland`, "Auslandserfahrung") is time abroad.
  country: [/country/i, /(?<![a-zäöü])land\b/i, /(?:wohnsitz|wohn|aufenthalts)land\b/i, /nation/i],
  linkedin: [/linkedin/i],
  github: [/github/i],
  website: [/website/i, /portfolio/i, /homepage/i, /personal[\s_-]?site/i],
  expectedSalary: [
    /desired[\s_-]?salary/i,
    // A qualifier between the words: "target annual salary (gross)", "Desired annual salary"
    // (Umantis), "Expected gross salary", "desired gross compensation".
    /(?:desired|expected|target)\b.{0,25}\b(?:salary|compensation)/i,
    /expected[\s_-]?salary/i,
    /salary[\s_-]?expectation/i,
    /expected[\s_-]?compensation/i,
    /desired[\s_-]?compensation/i,
    /compensation[\s_-]?expectation/i,
    /gehaltsvorstellung/i,
    /wunschgehalt/i,
    /gehaltserwartung/i,
    /gehalts?wunsch/i,
    /einkommensvorstellung/i,
  ],
};

/**
 * Patterns that only count on a choice field (`<select>`, radio group, combobox): a free-text
 * "Title" box is an academic title or a job title, not Mr/Ms.
 */
export const CHOICE_ONLY_PATTERNS: Partial<Record<ProfileFieldKey, RegExp[]>> = {
  salutation: [/^title$/i, /geschlecht/i, /gender/i],
};

/**
 * A field whose label says it is *not* the applicant's own value for the matched field, even
 * though a keyword matched: an address-line-2 box ("Adresszusatz" — d.vinci names it `address1`),
 * a second phone number. Checked against every signal (label, placeholder, name…), and it vetoes
 * the match outright.
 */
export const FIELD_VETO_PATTERNS: Partial<Record<ProfileFieldKey, RegExp[]>> = {
  address: [/adress-?zusatz|zusatz|address[\s_-]*line[\s_-]*2|addition|apartment|suite|\bc\/o\b/i],
  phone: [/alternativ|alternate|secondary|zweit|weitere|\bfax\b/i],
  // Nationality, a birthplace or time abroad is not the country the applicant lives in.
  country: [/nationalit|staatsangeh|citizenship|ausland|abroad|geburt|birth/i],
};

/**
 * A field about somebody else — the employee who referred the applicant, a reference, an
 * emergency contact — carries "Vorname"/"E-Mail"/"Telefon" too, and must never get the
 * applicant's own data (d.vinci: "Vor- und Nachname des Mitarbeiters (m/w/d)").
 */
export const OTHER_PERSON_RE =
  /des mitarbeiters|mitarbeiter(?:in)?s?name|empfehlungsgeber|empfohlen|referr(?:er|ed|al)|referee|referenz|\breference\b|ansprechpartner|kontaktperson|notfall|emergency|vorgesetzte|supervisor/i;

export const FIELD_ORDER: ProfileFieldKey[] = Object.keys(FIELD_PATTERNS) as ProfileFieldKey[];
