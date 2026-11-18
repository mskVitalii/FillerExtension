import type { Profile, ProfileFieldKey } from "@/types/profile";
import type { DateInputKind } from "@/lib/date-format";

/** The two documents the extension uploads on its own. */
export type UploadKind = "cv" | "coverLetter";

/**
 * What an upload slot is for (`file-upload/inject-file.ts#fileSlotsOf`). German forms offer
 * several, and each document belongs in one: "Lebenslauf" (cv), "Anschreiben" (coverLetter),
 * "Bewerbungsunterlagen" / "Komplette Unterlagen" / "Application file" (documents: the whole
 * application, CV included), "Zeugnisse" / "Zertifikate" (references), "Foto" (photo), and a CV
 * *parser* upload that only reads the CV to prefill the form (rexx `#cvparser`, d.vinci's
 * Textkernel "Lebenslauf hochladen") — never an attachment. One slot can be several at once:
 * rexx's "Anschreiben / Komplette Unterlagen".
 */
export type FileSlot = UploadKind | "documents" | "references" | "photo" | "parser";

/**
 * Per-ATS knowledge the generic autofill engine can't derive from labels alone: which widget a
 * vendor uses for a dropdown or a date, which ids are profile fields, which fields must never be
 * touched, where the CV slot is, and where in a multi-step flow the page is. Every hook is
 * optional: an adapter states only what its ATS does differently, and an `undefined` answer
 * always means "not mine, do the generic thing". Keep adapters to facts about the ATS's own
 * markup (stable names, ids, test ids — never generated CSS class hashes); anything true of
 * forms in general belongs in the engine itself.
 */
export interface AtsAdapter {
  /** Stable short name, as in fill statistics (`fill-stats/stats.ts#atsOf`). */
  id: string;
  /**
   * True when `doc` (loaded from `url`) is this ATS's page — by host, or by DOM markers when it's
   * served from the employer's own domain or embedded in an iframe.
   */
  detect(url: URL, doc: Document): boolean;

  // --- Fields: the profile pass -------------------------------------------------------------

  /** Fillable elements the generic selector misses (Workday's `<button aria-haspopup="listbox">`). */
  extraFillables?(doc: Document): HTMLElement[];
  /**
   * Not a field any automatic pass (profile autofill, question scan, consent checkboxes, file
   * upload) may touch: a voluntary EEO / demographic survey, a "parse my resume" uploader that
   * would overwrite what autofill typed, a widget's hidden value carrier.
   */
  isIgnored?(el: HTMLElement): boolean;
  /**
   * The profile field `el` holds when the ATS's own naming says so and the label doesn't
   * (Personio's `location` is the applicant's city). `undefined` = no opinion, let the generic
   * detector decide; `null` = definitely not a profile field.
   */
  mapField?(el: HTMLElement): ProfileFieldKey | null | undefined;
  /** Writes a profile value into an ATS widget. `undefined` = not mine, the engine fills it. */
  fillField?(el: HTMLElement, field: ProfileFieldKey, value: string, profile: Profile): Promise<boolean> | undefined;
  /** Runs after the profile pass for fields with an obvious answer but no profile key. Returns how many it filled. */
  afterFill?(profile: Profile, doc: Document): Promise<number>;
  /**
   * The ATS's own label for `el` when the generic label lookup can't reach it (a question title
   * that isn't a `<label for>` of the field). One more label signal for field detection and
   * consent checkboxes, and the question when the field's own label isn't one.
   */
  fieldLabel?(el: HTMLElement): string | null;

  // --- Questions ----------------------------------------------------------------------------

  /** The question a field asks, overriding what its own label says (one section of a split date widget). */
  questionText?(el: HTMLElement): string | undefined;
  /** Extra facts about a question field (its hidden options, its date shape). */
  questionHints?(el: HTMLElement): Promise<QuestionHints | undefined>;
  /** Writes an AI answer into a question field. `undefined` = not mine. */
  fillAnswer?(el: HTMLElement, answer: string): Promise<boolean> | undefined;

  // --- Checkboxes ---------------------------------------------------------------------------

  /** True for a checkbox that is one option of a multiple-choice question, not a consent box. */
  isChoiceOption?(el: HTMLElement): boolean;
  /** The container that plays the role of `<form>` on a page built without one (consent checkboxes are scoped to it). */
  formRoot?(el: HTMLElement): HTMLElement | null;

  // --- Files --------------------------------------------------------------------------------

  /**
   * The file inputs for a CV / cover letter in this ATS's own slots. Final when given: `[]`
   * means this form has no slot for it (so no generic "lone input" fallback may fire);
   * `undefined` defers to the generic label match.
   */
  fileInputs?(doc: Document, kind: UploadKind): HTMLInputElement[] | undefined;
  /** Slots of one upload input, overriding the generic label reading (`fileSlotsOf`); `undefined` = generic. */
  fileSlots?(input: HTMLInputElement): FileSlot[] | undefined;
  /**
   * True when choosing a file in `input` *adds* an upload (the widget sends each file at once
   * and lists it) rather than replacing the input's file, so a second document may follow the
   * first into the same slot.
   */
  appendsUploads?(input: HTMLInputElement): boolean;
  /** Where a document goes when no upload slot is labelled for it (softgarden's "further attachments"). */
  fallbackFileInput?(kind: UploadKind, doc: Document): HTMLInputElement | null;

  // --- Multi-step flows ---------------------------------------------------------------------

  /**
   * When the page is a step before the application form (a posting, a "how do you want to
   * apply" chooser), where the form is: a URL to open, or the element a user would click.
   * `null` on the form itself.
   */
  formEntry?(url: URL, doc: Document): { url?: string; click?: HTMLElement } | null;
  /** Where in a multi-step flow the page is (`atsStep`). */
  step?(doc: Document): AtsStep;
  /**
   * On a multi-step form, the control that shows or moves to the next step of the *same* form
   * (never the final submit), or `null` on the last step. For a driver (the local agent) to
   * advance the form; the content script itself never clicks it.
   */
  nextStep?(doc: Document): HTMLElement | null;
  /** The button that sends the application — for a driver to stop before and hand to the user. */
  submitButton?(doc: Document): HTMLElement | null;
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
