import { resolveLocator, type ElementLocator } from "@/features/autofill/element-locator";
import { elementSignalParts } from "@/features/autofill/field-detector";
import { fieldQuestionText } from "@/features/autofill/field-signal";
import { activeAtsAdapter } from "@/features/autofill/ats";
import type { FileSlot } from "@/features/autofill/ats/types";

/**
 * Pushes a File into whatever upload mechanism the page exposes (spec
 * section 18). Standard `<input type="file">` is reliable; drag-and-drop
 * zones and custom React upload widgets cannot be guaranteed universally,
 * so this best-efforts both and reports how many targets it hit.
 *
 * When `targetLocator` is given (the user dropped the attachment onto a
 * specific field — see `file-upload/drop-catcher.ts`), only that element is
 * used. Otherwise every file input / dropzone on the page is a *candidate*,
 * but a page with several (CV, cover letter, ID scan, portfolio, photo…)
 * must not get the same file sprayed into all of them — see
 * `matchingTargets` below.
 */

export type FileKind = "cv" | "coverLetter";

const LABEL_PATTERNS: Record<FileKind, RegExp[]> = {
  cv: [/\bcv\b/i, /r[ée]sum[ée]/i, /curriculum\s*vitae/i, /lebenslauf/i],
  coverLetter: [
    /cover[\s_-]?letter/i,
    /motivation[\s_-]?letter/i,
    /letter\s+of\s+motivation/i,
    /anschreiben/i,
    /motivationsschreiben/i,
    /lettre\s*de\s*motivation/i,
  ],
};

function textMatchesKind(text: string, kind: FileKind): boolean {
  return LABEL_PATTERNS[kind].some((pattern) => pattern.test(text));
}

/**
 * Narrows a page-wide candidate list to the ones actually labelled for
 * `kind` (spec: "Upload your CV" must not also catch "Upload a photo" or
 * "Upload references"). Falls back to the single candidate on the page when
 * none match the label patterns — an unlabelled lone file field is still an
 * unambiguous target — but never blind-fills when there's more than one and
 * none look like a match.
 */
function matchingTargets<T>(candidates: T[], kind: FileKind | null, matches: (candidate: T) => boolean): T[] {
  if (!kind) return candidates;
  const matched = candidates.filter(matches);
  if (matched.length > 0) return matched;
  return candidates.length === 1 ? candidates : [];
}

function buildDataTransfer(file: File): DataTransfer {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer;
}

function setFileInput(input: HTMLInputElement, file: File): boolean {
  if (input.disabled) return false;
  input.files = buildDataTransfer(file).files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export type { FileSlot };

const SLOT_PATTERNS: Record<Exclude<FileSlot, "cv" | "coverLetter" | "parser">, RegExp> = {
  photo: /\bfoto\b|photo|bewerbungsbild|\bbild\b|picture|avatar|profilbild/i,
  references: /zeugnis|zertifikat|certificate|referenz|\breferences?\b|nachweis|diplom|transcript|abschl[üu]ss|qualifikation/i,
  documents: /unterlagen|dokument|document|anlage|attachment|application\s*file|\bbewerbung\b/i,
};

const PARSER_RE = /cv[_-]?parser|resume[_-]?parser|parse|textkernel|prefill|autofill|import[_-]?profile/i;

function isParserUpload(input: HTMLInputElement): boolean {
  for (let el: HTMLElement | null = input; el && el !== document.body; el = el.parentElement) {
    if (PARSER_RE.test(`${el.id} ${el.getAttribute("name") ?? ""} ${el.getAttribute("class") ?? ""}`)) return true;
  }
  const action = input.form?.getAttribute("action") ?? "";
  return PARSER_RE.test(action);
}

/** Every slot `input` is labelled for (see `FileSlot`); empty when its label says nothing. */
export function fileSlotsOf(input: HTMLInputElement): Set<FileSlot> {
  const override = activeAtsAdapter()?.fileSlots?.(input);
  if (override) return new Set(override);
  if (isParserUpload(input)) return new Set(["parser"]);
  const parts = [...elementSignalParts(input), fieldQuestionText(input)];
  const slots = new Set<FileSlot>();
  for (const kind of ["cv", "coverLetter"] as const) {
    if (parts.some((part) => textMatchesKind(part, kind))) slots.add(kind);
  }
  for (const [slot, re] of Object.entries(SLOT_PATTERNS) as [FileSlot, RegExp][]) {
    if (parts.some((part) => re.test(part))) slots.add(slot);
  }
  return slots;
}

/**
 * The file inputs `kind` goes into, best first: its own slot; for a CV with no slot of its own,
 * the one "complete documents" slot (never a references/photo/parser slot); and an unlabelled
 * lone upload. A cover letter never replaces a file already in a shared slot (rexx's
 * "Anschreiben / Komplette Unterlagen", where the CV went first).
 */
function fileTargets(all: HTMLInputElement[], kind: FileKind): HTMLInputElement[] {
  const slotted = all.map((input) => ({ input, slots: fileSlotsOf(input) }));
  const usable = slotted.filter(({ slots }) => !slots.has("parser") && !slots.has("photo"));
  const own = usable.filter(({ slots }) => slots.has(kind) && !(kind === "cv" && slots.has("references") && !slots.has("documents")));
  if (kind === "coverLetter") {
    const appends = activeAtsAdapter()?.appendsUploads?.bind(null);
    return own
      .filter(({ input, slots }) => !(input.files?.length && hasOtherSlot(slots) && !appends?.(input)))
      .map((s) => s.input);
  }
  if (own.length > 0) return own.map((s) => s.input);
  const documents = usable.filter(({ slots }) => slots.has("documents") && !(slots.has("references") && !slots.has("coverLetter")));
  if (documents.length > 0) return [documents[0].input];
  // The page's only upload, saying nothing about what it wants, is unambiguous (a photo slot next
  // to it is not: then nothing is filled rather than a guess).
  const uploads = slotted.filter(({ slots }) => !slots.has("parser"));
  return uploads.length === 1 && uploads[0].slots.size === 0 ? [uploads[0].input] : [];
}

/** A cover-letter slot that is also the documents slot — shared with the CV. */
function hasOtherSlot(slots: Set<FileSlot>): boolean {
  return slots.has("documents") || slots.has("cv");
}

function fillNativeFileInputs(file: File, kind: FileKind | null): number {
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) => !input.disabled);
  const targets = kind ? fileTargets(all, kind) : all;
  let count = 0;
  for (const input of targets) {
    if (setFileInput(input, file)) count++;
  }
  return count;
}

const DROPZONE_SELECTOR = [
  '[data-testid*="dropzone" i]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  "[ondrop]",
  '[aria-label*="drag" i]',
].join(", ");

function dispatchDropOn(zone: HTMLElement, file: File): void {
  const dataTransfer = buildDataTransfer(file);
  for (const type of ["dragenter", "dragover", "drop"] as const) {
    zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
  }
}

function dispatchDropEvents(file: File, kind: FileKind | null): number {
  const all = Array.from(document.querySelectorAll<HTMLElement>(DROPZONE_SELECTOR));
  const targets = matchingTargets(all, kind, (zone) => textMatchesKind(zone.textContent ?? "", kind!));
  let count = 0;
  for (const zone of targets) {
    dispatchDropOn(zone, file);
    count++;
  }
  return count;
}

/** Inject into a single element the user dropped onto. */
function injectAtTarget(file: File, locator: ElementLocator): { nativeInputs: number; dropZones: number } {
  const el = resolveLocator(locator);
  if (!el) return { nativeInputs: 0, dropZones: 0 };

  if (el instanceof HTMLInputElement && el.type === "file") {
    return { nativeInputs: setFileInput(el, file) ? 1 : 0, dropZones: 0 };
  }

  const innerInput = el.querySelector<HTMLInputElement>('input[type="file"]');
  const nativeInputs = innerInput && setFileInput(innerInput, file) ? 1 : 0;
  dispatchDropOn(el, file);
  return { nativeInputs, dropZones: 1 };
}

export function injectFileIntoPage(
  file: File,
  targetLocator?: ElementLocator | null,
  kind: FileKind | null = null,
): { nativeInputs: number; dropZones: number } {
  if (targetLocator) return injectAtTarget(file, targetLocator);
  return {
    nativeInputs: fillNativeFileInputs(file, kind),
    dropZones: dispatchDropEvents(file, kind),
  };
}
