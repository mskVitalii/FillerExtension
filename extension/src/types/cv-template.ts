/**
 * How a `{{placeholder}}`'s value is chosen per job posting:
 * - `choice` — always exactly one of `options` (e.g. main_language: Go / C# / JavaScript / Python).
 * - `free` — `options` are just examples of the expected shape; the AI (or the user) may write
 *   any value in that shape (e.g. city: whatever the posting's location is, keywords: a list
 *   pulled from the posting).
 */
export type CvVariableMode = "choice" | "free";

export interface CvVariable {
  /** Matches `{{name}}` in the template — letters, digits, `_`, `-`. */
  name: string;
  /** What this placeholder stands for and how to pick it — shown in the UI and sent to the AI as its instruction. */
  description: string;
  /** Predefined variants. May be multi-line (e.g. a whole block of bullet points to swap per stack). */
  options: string[];
  mode: CvVariableMode;
}

/**
 * - `markdown` — the CV is written in the Markdown subset of
 *   `features/cv-template/markdown.ts` and rendered to PDF by the extension.
 *   Used for a PDF CV, which can't be edited in place.
 * - `docx` — the CV *is* the user's own Word file from the CV library, with
 *   `{{placeholders}}` typed into it; only those are replaced
 *   (`features/cv-template/docx.ts`) and the output is a .docx with the
 *   original layout intact.
 */
export type CvTemplateFormat = "markdown" | "docx";

/**
 * How one CV from the library adapts per posting: the definitions of its
 * `{{placeholders}}`, plus — for a `markdown` template — the template text.
 * For `docx`, `content` mirrors the Word file's extracted text (read-only,
 * edited in Word) so placeholder detection, the AI and the preview can work
 * from it.
 */
export interface CvTemplate {
  format: CvTemplateFormat;
  content: string;
  variables: CvVariable[];
  updatedAt: string;
}

/** Keyed by `CvMeta.id` — every CV in the library carries its own placeholder set. */
export type CvTemplateLibrary = Record<string, CvTemplate>;

export const EMPTY_CV_TEMPLATE: CvTemplate = { format: "markdown", content: "", variables: [], updatedAt: "" };

/** One AI-picked value for a placeholder, with a short why so the user can judge it at a glance. */
export interface CvValueSuggestion {
  name: string;
  value: string;
  reason: string;
}
