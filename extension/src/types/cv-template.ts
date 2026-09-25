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
 * The CV file is always the template — the extension never rebuilds a CV,
 * it only fills the `{{placeholders}}` the user typed into it:
 * - `docx` — a Word file; only the placeholders' text changes
 *   (`features/cv-template/docx.ts`), the PDF comes from Google Docs.
 * - `pdf` — a PDF; the placeholders are redrawn in place, in the PDF's own
 *   fonts (`features/cv-template/pdf.ts`).
 * - `latex` — an Overleaf project (.zip) or a .tex; the placeholders are
 *   replaced in the source and it's compiled again (`features/cv-template/latex.ts`).
 */
export type CvTemplateFormat = "docx" | "pdf" | "latex";

/**
 * How one CV from the library adapts per posting. `format` and `content`
 * are derived from the CV itself each time (`content` is the CV's text, where
 * placeholders are detected and which the AI and the preview read); only
 * `variables` — the user's definitions — are really stored. Entries saved
 * before, with a `markdown` format and a template text, still load: only
 * their variables are used.
 */
export interface CvTemplate {
  format: CvTemplateFormat;
  content: string;
  variables: CvVariable[];
  updatedAt: string;
}

/** Keyed by `CvMeta.id` — every CV in the library carries its own placeholder set. */
export type CvTemplateLibrary = Record<string, CvTemplate>;

export const EMPTY_CV_TEMPLATE: CvTemplate = { format: "pdf", content: "", variables: [], updatedAt: "" };

/** One AI-picked value for a placeholder, with a short why so the user can judge it at a glance. */
export interface CvValueSuggestion {
  name: string;
  value: string;
  reason: string;
}
