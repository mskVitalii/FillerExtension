import { resolveLocator, type ElementLocator } from "@/features/autofill/element-locator";
import { elementSignalParts } from "@/features/autofill/field-detector";
import { activeAtsAdapter, isAtsIgnored, type UploadKind } from "@/features/autofill/ats";

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

export type FileKind = UploadKind;

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

function elementMatchesKind(el: HTMLElement, kind: FileKind): boolean {
  return elementSignalParts(el).some((part) => LABEL_PATTERNS[kind].some((pattern) => pattern.test(part)));
}

/** `name`/`id` only — the ATS's own naming (`candidate.coverLetterFile`, `documents.cv`). */
function identifierMatchesKind(el: HTMLElement, kind: FileKind): boolean {
  return [el.getAttribute("name"), el.getAttribute("id")].some(
    (part) => part && LABEL_PATTERNS[kind].some((pattern) => pattern.test(part)),
  );
}

function textMatchesKind(text: string, kind: FileKind): boolean {
  return LABEL_PATTERNS[kind].some((pattern) => pattern.test(text));
}

function matchesAnotherKind(el: HTMLElement, kind: FileKind): boolean {
  return (Object.keys(LABEL_PATTERNS) as FileKind[]).some((other) => other !== kind && elementMatchesKind(el, other));
}

/**
 * Narrows a page-wide candidate list to the ones actually labelled for
 * `kind` (spec: "Upload your CV" must not also catch "Upload a photo" or
 * "Upload references"). In order:
 *  1. inputs whose own `name`/`id` say so — Recruitee has a `candidate.coverLetterFile` slot
 *     *and* an employer question "Hier können Sie ein Anschreiben hochladen"; the cover
 *     letter belongs in the first only;
 *  2. inputs whose label says so;
 *  3. the slot the ATS adapter names for it (softgarden's "Weitere Anhänge", Personio's
 *     "Andere") when the form has no slot of its own for this document;
 *  4. the single file input on the page, an unambiguous target even unlabelled — unless it is
 *     labelled for the *other* document (join.com's step with only the CV slot must not get
 *     the cover letter, which would replace the CV).
 * Never blind-fills when there's more than one and none look like a match.
 */
function nativeTargets(kind: FileKind | null): HTMLInputElement[] {
  // An uploader the ATS adapter rules out (a "parse my resume" box that would overwrite the form).
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) => !isAtsIgnored(input));
  if (!kind) return all;
  const byIdentifier = all.filter((input) => identifierMatchesKind(input, kind));
  if (byIdentifier.length > 0) return byIdentifier;
  const byLabel = all.filter((input) => elementMatchesKind(input, kind));
  if (byLabel.length > 0) return byLabel;
  const fromAts = activeAtsAdapter()?.fallbackFileInput?.(kind, document);
  if (fromAts) return [fromAts];
  return all.length === 1 && !matchesAnotherKind(all[0], kind) ? all : [];
}

/**
 * Dropzones: the ones whose text names `kind`, else the single zone on the page — unless that
 * zone names the *other* document (the cover letter would replace the CV just attached).
 */
function matchingTargets<T>(candidates: T[], kind: FileKind | null, matches: (candidate: T, kind: FileKind) => boolean): T[] {
  if (!kind) return candidates;
  const matched = candidates.filter((c) => matches(c, kind));
  if (matched.length > 0) return matched;
  const other: FileKind = kind === "cv" ? "coverLetter" : "cv";
  return candidates.length === 1 && !matches(candidates[0], other) ? candidates : [];
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

function fillNativeFileInputs(file: File, kind: FileKind | null): number {
  let count = 0;
  for (const input of nativeTargets(kind)) {
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
  // A zone wrapping its own `<input type="file">` is served through that input above
  // (softgarden's tiles, join.com's Chakra dropzones): dropping on it too would upload twice,
  // or put this file into the zone of the *other* document when it's the only zone left.
  const all = Array.from(document.querySelectorAll<HTMLElement>(DROPZONE_SELECTOR)).filter(
    (zone) => !zone.querySelector('input[type="file"]') && !isAtsIgnored(zone),
  );
  const targets = matchingTargets(all, kind, (zone, k) => textMatchesKind(zone.textContent ?? "", k));
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
  // An ATS adapter knows its own CV / cover-letter slots (labelled through a row or a section
  // heading, not the input). Its answer is final, even when it's "no slot": a cover letter must
  // never land in the CV's only uploader, and no drop-zone guessing happens on top.
  const slots = kind ? activeAtsAdapter()?.fileInputs?.(document, kind) : undefined;
  if (slots) return { nativeInputs: slots.filter((input) => setFileInput(input, file)).length, dropZones: 0 };
  return {
    nativeInputs: fillNativeFileInputs(file, kind),
    dropZones: dispatchDropEvents(file, kind),
  };
}
