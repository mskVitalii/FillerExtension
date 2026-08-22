/** Common salutation options ATS forms ask for — kept as exact strings so a
 * page's own <select> (e.g. options "Herr"/"Frau") can be matched by text. */
export const SALUTATION_OPTIONS = ["Mr", "Mrs", "Ms", "Mx", "Herr", "Frau"] as const;
export type Salutation = (typeof SALUTATION_OPTIONS)[number];

export interface Profile {
  salutation: string;
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
  fileName: string;
  mimeType: string;
  driveFileId: string | null;
  /** Locally extracted plain text, used as AI context instead of sending the PDF. */
  text: string;
  uploadedAt: string;
}

export interface PersonalLegend {
  content: string;
  updatedAt: string;
}
