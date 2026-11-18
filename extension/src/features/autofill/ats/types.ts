import type { Profile, ProfileFieldKey } from "@/types/profile";
import type { DateInputKind } from "@/lib/date-format";

/**
 * Per-ATS knowledge the generic autofill engine can't derive from labels alone: which
 * widget a vendor uses for a dropdown or a date, which ids are profile fields, which
 * fields must never be touched, where the CV slot is, and where in a multi-step flow
 * the page is. Every hook is optional — an adapter adds only what its ATS needs, and
 * an `undefined` answer always means "not mine, do the generic thing".
 */
export interface AtsAdapter {
  /** Stable name, matches `fill-stats` ATS names ("workday", "successfactors", …). */
  id: string;
  /** True when `doc` (at `url`) is this ATS — by host, or by DOM markers for a custom domain. */
  detect(url: string, doc: Document): boolean;
  /** Fillable elements the generic selector misses (e.g. Workday's `<button aria-haspopup="listbox">`). */
  extraFillables?(doc: Document): HTMLElement[];
  /** Not a form field at all: skipped by the profile pass, question scan and checkbox scan. */
  isIgnored?(el: HTMLElement): boolean;
  /** Profile field for `el`: a key, `null` = never fill from the profile, `undefined` = ask the generic detector. */
  mapField?(el: HTMLElement): ProfileFieldKey | null | undefined;
  /** Writes a profile value into an ATS widget. `undefined` = not mine, the engine fills it. */
  fillField?(el: HTMLElement, field: ProfileFieldKey, value: string, profile: Profile): Promise<boolean> | undefined;
  /** Runs after the profile pass for fields with an obvious answer but no profile key. Returns how many it filled. */
  afterFill?(profile: Profile, doc: Document): Promise<number>;
  /** The question a field asks, when its own label doesn't say it (one section of a split date widget). */
  questionText?(el: HTMLElement): string | undefined;
  /** Extra facts about a question field (its hidden options, its date shape). */
  questionHints?(el: HTMLElement): Promise<QuestionHints | undefined>;
  /** Writes an AI answer into a question field. `undefined` = not mine. */
  fillAnswer?(el: HTMLElement, answer: string): Promise<boolean> | undefined;
  /** The container that plays the role of `<form>` on a page built without one (consent checkboxes are scoped to it). */
  formRoot?(el: HTMLElement): HTMLElement | null;
  /** File inputs for a CV / cover letter, in this ATS's own slots. `undefined` = use the generic label match. */
  fileInputs?(doc: Document, kind: "cv" | "coverLetter"): HTMLInputElement[] | undefined;
  /** Where in a multi-step flow the page is. */
  step?(doc: Document): AtsStep;
}

export interface QuestionHints {
  options?: string[];
  dateKind?: DateInputKind;
}

export type AtsStepKind =
  /** The job posting itself, with an Apply button. */
  | "posting"
  /** "How do you want to apply?" — manual / with resume / last application. */
  | "start"
  | "login"
  /** Account creation. The agent must never do this unattended: the user decides. */
  | "register"
  /** A data-privacy statement that must be read and accepted. */
  | "consent"
  /** One page of the application form. */
  | "form"
  /** The last page; its "next" button submits. */
  | "review"
  | "submitted"
  | "unknown";

export interface AtsStep {
  ats: string;
  kind: AtsStepKind;
  /** Human-readable step name ("My Information", "Personal Information"), "" when unknown. */
  name: string;
  /** 1-based position in the flow's progress bar, when the page shows one. */
  index: number | null;
  total: number | null;
  /** The button that moves the flow forward on this step (Next, Apply manually, Sign In…). */
  next: HTMLElement | null;
  /** True when `next` submits the application — only ever pressed with the user's go-ahead. */
  nextIsSubmit: boolean;
  back: HTMLElement | null;
  /** Validation messages the page currently shows. */
  errors: string[];
}

/** One job in a CV's work history, as Workday's "My Experience" and similar repeaters ask for it. */
export interface WorkEntry {
  title: string;
  company: string;
  location?: string;
  /** `YYYY-MM` (or `YYYY`). */
  from: string;
  /** `YYYY-MM` (or `YYYY`); absent or null = current job. */
  to?: string | null;
  description?: string;
}

export interface EducationEntry {
  school: string;
  degree?: string;
  fieldOfStudy?: string;
  /** `YYYY-MM` or `YYYY`. */
  from?: string;
  to?: string;
  grade?: string;
}

/** Structured history read from the CV (see `features/openai/extract-cv-history.ts`). */
export interface CvHistory {
  work: WorkEntry[];
  education: EducationEntry[];
  /** Personal websites (portfolio, GitHub…), in order of preference. */
  websites?: string[];
}
