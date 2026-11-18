import { resolveLocator, type ElementLocator } from "@/features/autofill/element-locator";
import { elementSignalParts } from "@/features/autofill/field-detector";
import { activeAtsAdapter, isAtsExcluded } from "@/features/autofill/ats";

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

function elementMatchesKind(el: HTMLElement, kind: FileKind): boolean {
  return elementSignalParts(el).some((part) => LABEL_PATTERNS[kind].some((pattern) => pattern.test(part)));
}

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
function matchingTargets<T>(
  candidates: T[],
  kind: FileKind | null,
  matches: (candidate: T, kind: FileKind) => boolean,
): T[] {
  if (!kind) return candidates;
  const matched = candidates.filter((c) => matches(c, kind));
  if (matched.length > 0) return matched;
  // The lone-input fallback must not hand a cover letter to the form's only upload when that
  // upload is labelled for the CV (Greenhouse/Lever forms with no cover-letter field) — the
  // cover letter would replace the CV the same run just attached.
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
  // The ATS knows its own CV / cover-letter slots (and which uploader would parse the file and
  // overwrite the form) — see ats/index.ts.
  const all = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) => !isAtsExcluded(input));
  const targets = matchingTargets(all, kind, elementMatchesKind);
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
  const all = Array.from(document.querySelectorAll<HTMLElement>(DROPZONE_SELECTOR)).filter((zone) => !isAtsExcluded(zone));
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
  // The ATS knows its own CV / cover-letter slots (and which uploader would parse the file and
  // overwrite the form) — see ats/index.ts. Its answer is final: no drop-zone guessing on top.
  const ats = kind ? activeAtsAdapter(document)?.fileInput?.(kind, document) : undefined;
  if (ats !== undefined) return { nativeInputs: ats && setFileInput(ats, file) ? 1 : 0, dropZones: 0 };
  return {
    nativeInputs: fillNativeFileInputs(file, kind),
    dropZones: dispatchDropEvents(file, kind),
  };
}
