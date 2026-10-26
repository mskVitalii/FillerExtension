import { mountOverlayHost, type OverlayHost } from "./overlay-host";

/**
 * Briefly outlines the fields a pick or a question scan just found, so the
 * user can see on the page *which* fields Filler took — before this the
 * only on-page feedback was the picker's hover box, which disappears on
 * click, so a successful pick looked exactly like nothing happening.
 *
 * Drawn in the shared top-layer overlay (`overlay-host.ts`), never by
 * styling the page's own elements (a site's `outline: none !important` or
 * an `overflow: hidden` card would swallow that). Boxes follow their field
 * every animation frame — scrolling, a sticky header shifting, a field
 * replaced by a re-render (`locate` finds the new node) — and the whole
 * overlay removes itself after `durationMs`.
 */
export interface HighlightTarget {
  el: HTMLElement;
  /** Finds the field again if the page replaced `el` while it's highlighted. */
  locate?: () => HTMLElement | null;
  /** Short text on the box's chip — the question, usually. */
  label?: string;
}

const STYLE = `
  @keyframes filler-field-in { from { opacity: 0; transform: scale(1.04); } to { opacity: 1; transform: none; } }
  .ring {
    position: fixed; box-sizing: border-box; pointer-events: none; border-radius: 6px;
    border: 2px solid #6366f1; background: rgba(99, 102, 241, 0.10);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
    animation: filler-field-in .18s ease-out;
    transition: opacity .4s ease-in;
  }
  .ring[data-off] { display: none; }
  .tag {
    position: absolute; left: -2px; bottom: 100%; margin-bottom: 3px; max-width: 280px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 11px/1.4 system-ui, -apple-system, sans-serif; color: #fff;
    background: #4f46e5; padding: 1px 6px; border-radius: 4px;
  }
  .fade .ring { opacity: 0; }
`;

const FADE_MS = 400;

let active: { overlay: OverlayHost; stop: () => void } | null = null;

/** Removes the current highlight, if any. */
export function clearFieldHighlights(): void {
  active?.stop();
}

const nextFrame = (fn: () => void): (() => void) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, 16);
  return () => clearTimeout(id);
};

export function highlightFields(targets: HighlightTarget[], durationMs = 4000): void {
  clearFieldHighlights();
  if (targets.length === 0) return;

  const overlay = mountOverlayHost(STYLE);
  const layer = document.createElement("div");
  overlay.shadow.append(layer);

  const items = targets.map((target, index) => {
    const ring = document.createElement("div");
    ring.className = "ring";
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.textContent = `${index + 1}${target.label ? ` · ${target.label}` : ""}`;
    ring.append(tag);
    layer.append(ring);
    return { ...target, ring, lastLocate: 0 };
  });

  let cancelFrame: (() => void) | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const paint = () => {
    for (const item of items) {
      // `locate` may rescan the whole form — a few times a second is plenty
      // to catch a re-render, every animation frame is not.
      const now = Date.now();
      if (!item.el.isConnected && item.locate && now - item.lastLocate > 250) {
        item.lastLocate = now;
        const fresh = item.locate();
        if (fresh) item.el = fresh;
      }
      const rect = item.el.isConnected ? item.el.getBoundingClientRect() : null;
      if (!rect || (rect.width === 0 && rect.height === 0)) {
        item.ring.setAttribute("data-off", "");
        continue;
      }
      item.ring.removeAttribute("data-off");
      item.ring.style.top = `${rect.top - 3}px`;
      item.ring.style.left = `${rect.left - 3}px`;
      item.ring.style.width = `${rect.width + 6}px`;
      item.ring.style.height = `${rect.height + 6}px`;
    }
  };

  const loop = () => {
    try {
      paint();
    } catch {
      /* a field's getter throwing must not leave the overlay stuck */
    }
    cancelFrame = nextFrame(loop);
  };

  const stop = () => {
    cancelFrame?.();
    for (const timer of timers) clearTimeout(timer);
    overlay.remove();
    if (active?.stop === stop) active = null;
  };

  active = { overlay, stop };
  loop();
  timers.push(setTimeout(() => layer.classList.add("fade"), Math.max(0, durationMs - FADE_MS)));
  timers.push(setTimeout(stop, durationMs));
}
