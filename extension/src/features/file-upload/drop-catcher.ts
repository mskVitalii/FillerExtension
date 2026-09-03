import { buildLocator } from "@/features/autofill/element-locator";

/**
 * Native drag-and-drop of a File out of an extension page (the Side Panel)
 * onto a web page is unreliable — Chrome frequently strips the
 * extension-origin File from `dataTransfer`, so the page's dropzone gets an
 * empty drop and nothing attaches. The Side Panel's drag therefore also
 * stamps a marker MIME type on the drag (`application/x-filler-attach-<kind>`);
 * this catcher sees that marker on drop, works out which field was dropped
 * onto, and asks the Side Panel to inject the real file there — the same
 * path the "click to attach" button already uses, just scoped to one field.
 */

const MARKER_PREFIX = "application/x-filler-attach-";

const DROPZONE_SELECTOR = [
  'input[type="file"]',
  '[data-testid*="dropzone" i]',
  '[class*="dropzone" i]',
  '[class*="drop-zone" i]',
  "[ondrop]",
  '[aria-label*="drag" i]',
].join(", ");

function markerKind(dataTransfer: DataTransfer | null): "cv" | "coverLetter" | null {
  const type = Array.from(dataTransfer?.types ?? []).find((t) => t.startsWith(MARKER_PREFIX));
  if (!type) return null;
  const suffix = type.slice(MARKER_PREFIX.length);
  return suffix === "cv" ? "cv" : suffix === "coverletter" ? "coverLetter" : null;
}

/** Nearest file input / dropzone at or above the drop point, or null for a page-wide inject. */
function nearestFileTarget(start: EventTarget | null): HTMLElement | null {
  let el: HTMLElement | null = start instanceof HTMLElement ? start : null;
  for (let depth = 0; el && depth < 8; depth++, el = el.parentElement) {
    if (el instanceof HTMLInputElement && el.type === "file") return el;
    const inside = el.querySelector('input[type="file"]');
    if (inside instanceof HTMLElement) return inside;
    if (el.matches(DROPZONE_SELECTOR)) return el;
  }
  return null;
}

export function initFileDropCatcher(): void {
  const allowDrop = (event: DragEvent) => {
    if (!markerKind(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  document.addEventListener("dragenter", allowDrop, true);
  document.addEventListener("dragover", allowDrop, true);

  document.addEventListener(
    "drop",
    (event) => {
      const kind = markerKind(event.dataTransfer);
      if (!kind) return;
      // We're handling this drop ourselves — stop the browser (and the
      // page) from treating the marker drag as a stray file/navigation.
      event.preventDefault();
      event.stopImmediatePropagation();

      const target = nearestFileTarget(event.target);
      const locator = target ? buildLocator(target, "") : null;
      void chrome.runtime.sendMessage({ type: "ATTACH_FILE_AT", kind, locator });
    },
    true,
  );
}
