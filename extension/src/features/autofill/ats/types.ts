/**
 * What an upload slot is for (`file-upload/inject-file.ts#fileSlotsOf`). German forms offer
 * several, and each document belongs in one: "Lebenslauf" (cv), "Anschreiben" (coverLetter),
 * "Bewerbungsunterlagen" / "Komplette Unterlagen" / "Application file" (documents: the whole
 * application, CV included), "Zeugnisse" / "Zertifikate" (references), "Foto" (photo), and a CV
 * *parser* upload that only reads the CV to prefill the form (rexx `#cvparser`, d.vinci's
 * Textkernel "Lebenslauf hochladen") — never an attachment. One slot can be several at once:
 * rexx's "Anschreiben / Komplette Unterlagen".
 */
export type FileSlot = "cv" | "coverLetter" | "documents" | "references" | "photo" | "parser";

/**
 * What one ATS needs beyond the generic engine. Every hook is optional: the generic detection
 * (labels, `select-facade.ts`, `honeypot.ts`, `fileSlotsOf`) handles most of each form, and an
 * adapter only adds what is specific to that ATS and can't be read off the page generically.
 */
export interface AtsAdapter {
  /** Short id, as in fill statistics (`fill-stats/stats.ts#atsOf`). */
  id: string;
  /** True when `doc` at `url` is this ATS's page (posting, intermediate step or form). */
  detect(url: URL, doc: Document): boolean;
  /** Slots of one upload input, overriding the generic label reading; `undefined` = generic. */
  fileSlots?(input: HTMLInputElement): FileSlot[] | undefined;
  /**
   * True when choosing a file in `input` *adds* an upload (the widget sends each file at once
   * and lists it) rather than replacing the input's file, so a second document may follow the
   * first into the same slot.
   */
  appendsUploads?(input: HTMLInputElement): boolean;
  /**
   * When the page is a step before the application form (a posting, an "how do you want to
   * apply" chooser), where the form is: a URL to open, or the element a user would click.
   * `null` on the form itself.
   */
  formEntry?(url: URL, doc: Document): { url?: string; click?: HTMLElement } | null;
  /**
   * On a multi-step form, the control that shows the next step of the *same* form (never the
   * submit button), or `null` on the last step. Fields of later steps exist but are hidden, so
   * autofill, questions and checkboxes run again after each step.
   */
  nextStep?(doc: Document): HTMLElement | null;
}
