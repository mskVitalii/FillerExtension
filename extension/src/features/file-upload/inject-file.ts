/**
 * Pushes a File into whatever upload mechanism the page exposes (spec
 * section 18). Standard `<input type="file">` is reliable; drag-and-drop
 * zones and custom React upload widgets cannot be guaranteed universally,
 * so this best-efforts both and reports how many targets it hit.
 */
function buildDataTransfer(file: File): DataTransfer {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  return dataTransfer;
}

function fillNativeFileInputs(file: File): number {
  const dataTransfer = buildDataTransfer(file);
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="file"]');
  let count = 0;
  for (const input of inputs) {
    if (input.disabled) continue;
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    count++;
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

function dispatchDropEvents(file: File): number {
  const dataTransfer = buildDataTransfer(file);
  const zones = document.querySelectorAll<HTMLElement>(DROPZONE_SELECTOR);
  let count = 0;
  for (const zone of zones) {
    for (const type of ["dragenter", "dragover", "drop"] as const) {
      zone.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }
    count++;
  }
  return count;
}

export function injectFileIntoPage(file: File): { nativeInputs: number; dropZones: number } {
  return {
    nativeInputs: fillNativeFileInputs(file),
    dropZones: dispatchDropEvents(file),
  };
}
