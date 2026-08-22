let lastFocusedEditable: HTMLElement | null = null;
let lastContextMenuTarget: HTMLElement | null = null;

function isEditable(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/**
 * Tracks focus and right-click targets so the Context Menu "Insert" action
 * (spec section 14) knows where to place a value. `contextmenu` fires right
 * before Chrome opens its native menu, so its target is the most reliable
 * signal — focus can lag or shift in some browsers.
 */
export function initFocusTracker(): void {
  document.addEventListener(
    "focusin",
    (event) => {
      if (isEditable(event.target)) lastFocusedEditable = event.target;
    },
    true,
  );
  document.addEventListener(
    "contextmenu",
    (event) => {
      if (isEditable(event.target)) lastContextMenuTarget = event.target;
    },
    true,
  );
}

export function getInsertTarget(): HTMLElement | null {
  return lastContextMenuTarget ?? lastFocusedEditable;
}
