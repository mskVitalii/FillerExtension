/**
 * The one way this content script puts something visual on top of a page
 * (the element picker's hover box, the picked/detected-field highlights).
 * Each of these used to be a plain `<div style="position:fixed;z-index:max">`
 * appended to `<html>`, which is invisible in more places than it looks:
 *
 * - **Stacking.** A native `<dialog>` opened with `showModal()`, a popover,
 *   or a fullscreen element lives in the browser's top layer and paints
 *   above any z-index. So did nothing on LinkedIn's Easy Apply modal.
 * - **Containing block.** `position: fixed` is relative to the nearest
 *   ancestor with a `transform`/`filter`/`contain`, not the viewport. Sites
 *   that put a transform on `<html>`/`<body>` (smooth-scroll libraries, zoom
 *   wrappers) shift the box off its target, more so the further you scroll.
 * - **Page CSS.** A site rule like `html > div { display: none !important }`
 *   or `div { transform: … }` reaches a bare `<div>` host.
 * - **Re-renders.** A framework that owns `<html>`'s children (or a
 *   hydration pass) can drop an unknown node it didn't render.
 *
 * So the host is a custom element (no `div` rule matches it) with every
 * property that matters set inline with `!important` (which beats even the
 * page's `!important` rules), promoted into the top layer as a manual
 * popover where supported, which also makes it immune to ancestor
 * transforms and z-index. It is put back if the page removes it.
 */

const HOST_TAG = "filler-overlay";
const HOST_ATTR = "data-filler-overlay";

const HOST_STYLE: Record<string, string> = {
  all: "initial",
  display: "block",
  position: "fixed",
  inset: "0",
  width: "100vw",
  height: "100vh",
  "max-width": "none",
  "max-height": "none",
  margin: "0",
  padding: "0",
  border: "0",
  background: "transparent",
  overflow: "visible",
  "z-index": "2147483647",
  "pointer-events": "none",
  visibility: "visible",
  opacity: "1",
  transform: "none",
  filter: "none",
  "clip-path": "none",
  contain: "none",
};

export interface OverlayHost {
  host: HTMLElement;
  shadow: ShadowRoot;
  remove(): void;
}

/** True for our own overlay nodes — so mutation observers (refill guard) can ignore what we paint. */
export function isOverlayNode(node: Node | null): boolean {
  const el = node instanceof Element ? node : node?.parentElement;
  return Boolean(el?.closest(`[${HOST_ATTR}]`));
}

/**
 * True for an overlay host itself, even once detached (a removed node has
 * no ancestors left for `isOverlayNode`'s `closest` to walk).
 */
export function isOverlayHostNode(node: Node): boolean {
  return node instanceof Element && node.hasAttribute(HOST_ATTR);
}

function showInTopLayer(host: HTMLElement): void {
  const popover = host as HTMLElement & { showPopover?: () => void };
  if (typeof popover.showPopover !== "function") return;
  try {
    if (!host.matches(":popover-open")) popover.showPopover();
  } catch {
    // Not connected yet / unsupported `:popover-open` — the fixed, max
    // z-index host still works everywhere a modal isn't in the way.
  }
}

export function mountOverlayHost(css: string): OverlayHost {
  const host = document.createElement(HOST_TAG);
  host.setAttribute(HOST_ATTR, "");
  host.setAttribute("popover", "manual");
  host.setAttribute("aria-hidden", "true");
  for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, "important");

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);

  // Inside an open modal `<dialog>` when there is one: a popover outside it
  // would still paint on top, but the rest of the document is inert while
  // it's open, and older Chrome (no popover) needs the dialog subtree.
  const parentFor = () => {
    const modal = document.querySelector(":modal");
    return modal instanceof HTMLElement ? modal : document.documentElement;
  };

  let removed = false;
  const attach = () => {
    parentFor().appendChild(host);
    showInTopLayer(host);
  };
  attach();

  const watchdog = new MutationObserver(() => {
    if (!removed && !host.isConnected) attach();
  });
  watchdog.observe(document.documentElement, { childList: true, subtree: true });

  return {
    host,
    shadow,
    remove() {
      removed = true;
      watchdog.disconnect();
      host.remove();
    },
  };
}
