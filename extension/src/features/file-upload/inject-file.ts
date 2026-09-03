import { resolveLocator, type ElementLocator } from "@/features/autofill/element-locator";

/**
 * Pushes a File into whatever upload mechanism the page exposes (spec
 * section 18). Standard `<input type="file">` is reliable; drag-and-drop
 * zones and custom React upload widgets cannot be guaranteed universally,
 * so this best-efforts both and reports how many targets it hit.
 *
 * When `targetLocator` is given (the user dropped the attachment onto a
 * specific field — see `file-upload/drop-catcher.ts`), only that element is
 * used; otherwise every file input / dropzone on the page is tried.
 */
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

function fillNativeFileInputs(file: File): number {
  let count = 0;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
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

function dispatchDropEvents(file: File): number {
  const zones = document.querySelectorAll<HTMLElement>(DROPZONE_SELECTOR);
  let count = 0;
  for (const zone of zones) {
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
): { nativeInputs: number; dropZones: number } {
  if (targetLocator) return injectAtTarget(file, targetLocator);
  return {
    nativeInputs: fillNativeFileInputs(file),
    dropZones: dispatchDropEvents(file),
  };
}
