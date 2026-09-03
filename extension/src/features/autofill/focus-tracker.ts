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
 * `document.activeElement` does not pierce open shadow roots — when focus
 * is inside one, the outer document only ever reports the shadow *host*
 * (a custom element, never itself an input/textarea/contenteditable), so a
 * plain `isEditable(document.activeElement)` check always misses fields
 * rendered by shadow-DOM-based widgets (increasingly common — many custom
 * search/combobox components are built this way). Each shadow root exposes
 * its own `activeElement`, unaffected by that retargeting, so descending
 * through it resolves the real focused element.
 */
function deepActiveElement(root: Document | ShadowRoot = document): Element | null {
  const active = root.activeElement;
  if (active?.shadowRoot?.activeElement) return deepActiveElement(active.shadowRoot);
  return active;
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
  // Checked first, ahead of the tracked-event fallbacks below: Chrome
  // focuses an editable element as part of right-clicking it, independent
  // of any JS listener, so this is correct even the very first time this
  // content script is injected into a tab — before which neither
  // `lastContextMenuTarget` nor `lastFocusedEditable` could have been
  // recorded yet, since nothing was listening for the click that opened
  // the menu the user is now acting on.
  const active = deepActiveElement();
  if (isEditable(active)) return active;
  return lastContextMenuTarget ?? lastFocusedEditable;
}
