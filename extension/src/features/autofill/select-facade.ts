import { collapse } from "./field-signal";

/**
 * jQuery select widgets (select2, jQuery UI selectmenu, chosen, bootstrap-select) draw a
 * `role="combobox"` facade over a native `<select>` that still holds — and submits — the value.
 * Filling the facade like a text box destroys it (its label text is replaced) and submits
 * nothing, so the native select is the field: set it and repaint the facade's label.
 *
 * - select2 keeps the select rendered (clipped to 1px), so the engine sees both; the facade is
 *   then a duplicate and is skipped, and select2 repaints itself from the select's `change`.
 * - jQuery UI selectmenu (rexx) and chosen hide the select (`display: none`); the facade is the
 *   only visible field, so it is filled *through* its select and repainted here, because those
 *   widgets don't listen to the select's `change` (`.selectmenu("refresh")` lives in the page's
 *   own jQuery, which a content script can't reach).
 */
export function backingSelect(el: HTMLElement): HTMLSelectElement | null {
  if (el instanceof HTMLSelectElement) return null;
  const doc = el.ownerDocument;
  const byId = (id: string | null | undefined): HTMLSelectElement | null => {
    if (!id) return null;
    const found = doc.getElementById(id);
    return found instanceof HTMLSelectElement ? found : null;
  };

  // jQuery UI selectmenu: <span id="gender-button" aria-owns="gender-menu"> over <select id="gender">.
  if (el.classList.contains("ui-selectmenu-button") || /-button$/.test(el.id)) {
    const select = byId(el.id.replace(/-button$/, ""));
    if (select) return select;
  }
  // select2: <span class="select2-selection" aria-labelledby="select2-<id>-container">, the
  // container right after <select class="select2-hidden-accessible">.
  const container = el.closest(".select2-container, .chosen-container, .bootstrap-select");
  if (container) {
    const labelled = el.getAttribute("aria-labelledby") ?? "";
    const m = /select2-(.+)-container/.exec(labelled);
    const fromLabel = m ? byId(m[1]) : null;
    if (fromLabel) return fromLabel;
    // chosen: <div id="<id>_chosen" class="chosen-container"> after the select.
    const chosen = container.id.endsWith("_chosen") ? byId(container.id.replace(/_chosen$/, "")) : null;
    if (chosen) return chosen;
    const inside = container.querySelector("select");
    if (inside) return inside;
    const prev = container.previousElementSibling;
    if (prev instanceof HTMLSelectElement) return prev;
  }
  return null;
}

/** Writes the chosen option's label into a selectmenu/chosen facade, as the widget would. */
export function repaintFacade(facade: HTMLElement, select: HTMLSelectElement): void {
  const label = collapse(select.selectedOptions[0]?.textContent ?? "");
  const text =
    facade.querySelector<HTMLElement>(".ui-selectmenu-text, .select2-selection__rendered, .chosen-single span, .filter-option-inner-inner") ??
    null;
  if (text) text.textContent = label;
}
