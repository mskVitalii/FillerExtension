import type { Profile, ProfileFieldKey } from "@/types/profile";

/** The two documents the extension uploads on its own. */
export type UploadKind = "cv" | "coverLetter";

/**
 * Per-ATS knowledge the generic autofill engine can't derive from labels alone. Every hook is
 * optional: an adapter states only what its ATS does differently, and an `undefined` answer
 * always means "no opinion, do the generic thing". Keep adapters to facts about the ATS's own
 * markup (stable names, ids, test ids — never generated CSS class hashes); anything true of
 * forms in general belongs in the engine itself.
 */
export interface AtsAdapter {
  /** Stable short name, as in fill statistics (`fill-stats/stats.ts#atsOf`). */
  id: string;
  /**
   * True when `doc` (loaded from `url`) is this ATS's page — by host, or by markup when it's
   * served from the employer's own domain or embedded in an iframe.
   */
  detect(url: URL, doc: Document): boolean;

  // --- Fields -------------------------------------------------------------------------------

  /**
   * Fields every automatic pass (profile autofill, question scan, consent checkboxes, file
   * upload) must leave alone: a voluntary EEO / demographic survey, a "parse my resume" uploader
   * that would overwrite what autofill typed, a widget's hidden value carrier.
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
  /**
   * The ATS's own label for `el` when the generic label lookup can't reach it (a question title
   * that isn't a `<label for>` of the field). One more label signal, never an identifier.
   */
  fieldLabel?(el: HTMLElement): string | null;
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
  /** Where a document goes when no upload slot is labelled for it (softgarden's "further attachments"). */
  fallbackFileInput?(kind: UploadKind, doc: Document): HTMLInputElement | null;

  // --- Multi-step flows ---------------------------------------------------------------------

  /**
   * On a multi-step form, the control that shows or moves to the next step of the *same* form
   * (never the final submit), or `null` on the last step. For a driver (the local agent) to
   * advance the form; the content script itself never clicks it.
   */
  nextStep?(doc: Document): HTMLElement | null;
  /** The button that sends the application — for a driver to stop before and hand to the user. */
  submitButton?(doc: Document): HTMLElement | null;
}
