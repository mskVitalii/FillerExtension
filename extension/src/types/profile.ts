import type { CefrLevel } from "@/lib/language-level";

/** Common salutation options ATS forms ask for — kept as exact strings so a
 * page's own <select> (e.g. options "Herr"/"Frau") can be matched by text. */
export const SALUTATION_OPTIONS = ["Mr", "Mrs", "Ms", "Mx", "Herr", "Frau"] as const;
export type Salutation = (typeof SALUTATION_OPTIONS)[number];

/** Pronoun choices offered in Settings — a `<select>`, matched against the page's own radio/select options. */
export const PRONOUN_OPTIONS = ["he/him", "she/her", "they/them", "prefer not to say"] as const;

export interface Profile {
  salutation: string;
  /** e.g. "he/him", "she/her", "they/them" — asked by many application forms, often as a radio group. */
  pronouns: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  linkedin: string;
  github: string;
  website: string;
  /** Desired salary/compensation, free text so it can carry a range or currency (e.g. "€70,000"). */
  expectedSalary: string;
}

export const EMPTY_PROFILE: Profile = {
  salutation: "",
  pronouns: "",
  firstName: "",
  lastName: "",
  fullName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  postalCode: "",
  country: "",
  linkedin: "",
  github: "",
  website: "",
  expectedSalary: "",
};

/** Semantic field keys autofill/context-menu can target. */
export type ProfileFieldKey = keyof Profile;

export interface CvMeta {
  id: string;
  fileName: string;
  mimeType: string;
  driveFileId: string | null;
  /** Locally extracted plain text, used as AI context instead of sending the PDF. */
  text: string;
  uploadedAt: string;
}

/** Every CV the user has uploaded, plus which one autofill/AI currently treats as "the" CV. */
export interface CvLibrary {
  items: CvMeta[];
  activeId: string | null;
}

export interface PersonalLegend {
  content: string;
  updatedAt: string;
}

/**
 * spec_5 section C: a condensed "who this candidate is" digest — profile,
 * CV, Personal Legend, custom fields, and language levels distilled into
 * one grounded summary — generated once and reused as the context handed
 * to a job-search query, instead of a bare role/location string or the raw
 * CV text re-sent on every search.
 */
export interface CandidateSummary {
  content: string;
  updatedAt: string;
}

/**
 * User-defined label/value pairs (spec_2 item 1) — draggable onto the page
 * like Profile fields, but deliberately never matched by the autofill engine
 * since there's no reliable semantic signal to detect them against.
 */
export interface CustomField {
  id: string;
  label: string;
  value: string;
}

/** The user's own proficiency per language (spec_3 item 2) — compared against a posting's
 * language requirements to flag whether it's worth their time. */
export interface LanguageLevel {
  language: string;
  level: CefrLevel;
}

/**
 * One answer to a standard interview-FAQ question (spec_5 section B,
 * `lib/faq-questions.ts`), pre-generated from CV + Personal Legend so a real
 * form's version of the same question can reuse a consistent, reviewed
 * answer instead of a fresh guess every time.
 */
export interface FaqEntry {
  question: string;
  answer: string;
}
