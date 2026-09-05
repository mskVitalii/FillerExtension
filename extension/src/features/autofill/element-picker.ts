import { decomposeContainer, type PickedField } from "./pick-questions";

const FIELD_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';

/**
 * Visual "pick the block that holds the questions" mode. The automatic scan
 * (`custom-questions.ts`) only catches fields whose label already reads like
 * a question; on the many custom-built application forms where it doesn't,
 * the user drops into this mode, hovers the block, and clicks it — we then
 * split it into fields + questions exactly as the auto scan would have.
 *
 * The overlay lives in a shadow root attached to `<html>` so the page's CSS
 * can't restyle it and its own keyframes can't leak onto the page. It runs
 * per-frame: `background/router.ts` starts it in every frame and the first
 * frame to report a pick wins (the block is often inside an ATS iframe).
 */
export type PickerOutcome =
  | { cancelled: true }
  | { cancelled: false; picked: PickedField[]; blockText: string; semanticCount: number };

let activeTeardown: (() => void) | null = null;

/** Dismiss a running picker in this frame (used when another frame won the pick). */
export function cancelActivePicker(): void {
  try {
    activeTeardown?.();
  } catch {
    // Teardown is best-effort — a throw here must not propagate to the caller
    // (background broadcasts CANCEL to every frame; one failing frame can't
    // be allowed to reject the whole Promise.all and stall the Side Panel).
    activeTeardown = null;
  }
}

/** Innermost element at the point, descending through open shadow roots. */
function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  try {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el?.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y) as HTMLElement | null;
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  } catch {
    return null;
  }
}

const STYLE = `
  @keyframes filler-picker-glow {
    0%, 100% { box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.28), 0 0 15px 1px rgba(99, 102, 241, 0.35); }
    50%      { box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.28), 0 0 24px 4px rgba(99, 102, 241, 0.6); }
  }
  .box {
    position: fixed; pointer-events: none; border-radius: 8px;
    animation: filler-picker-glow 2s ease-in-out infinite;
    transition: top .07s ease-out, left .07s ease-out, width .07s ease-out, height .07s ease-out;
  }
  .box::before {
    content: ""; position: absolute; inset: -2px; border-radius: 10px; padding: 2px;
    background: linear-gradient(120deg, #6366f1, #22d3ee, #a855f7, #ec4899);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
            mask-composite: exclude;
  }
  .chip {
    position: fixed; transform: translateY(calc(-100% - 6px));
    font: 12px/1.4 system-ui, -apple-system, sans-serif; color: #fff;
    background: #4f46e5; padding: 4px 8px; border-radius: 6px;
    white-space: nowrap; pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
`;

export function startElementPicker(): Promise<PickerOutcome> {
  cancelActivePicker();

  return new Promise<PickerOutcome>((resolve) => {
    // The whole overlay setup runs inside one guard: any throw here (a hostile
    // page overriding a DOM primitive, a stale document during navigation)
    // must still resolve the Promise so the Side Panel's `await` returns and
    // the picker loop doesn't wedge.
    try {
      runPicker(resolve);
    } catch {
      resolve({ cancelled: true });
    }
  });
}

function runPicker(resolve: (outcome: PickerOutcome) => void): void {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const box = document.createElement("div");
  box.className = "box";
  box.hidden = true;
  const chip = document.createElement("div");
  chip.className = "chip";
  chip.hidden = true;
  shadow.append(style, box, chip);
  document.documentElement.appendChild(host);

  let current: HTMLElement | null = null;
  let done = false;

  const paint = () => {
    if (!current) {
      box.hidden = true;
      chip.hidden = true;
      return;
    }
    const r = current.getBoundingClientRect();
    box.hidden = false;
    box.style.top = `${r.top}px`;
    box.style.left = `${r.left}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;

    // Cheap approximate count for the hover chip — the accurate
    // shadow-piercing pass runs once, at pick time, in decomposeContainer.
    const count = current.querySelectorAll(FIELD_SELECTOR).length || (current.matches(FIELD_SELECTOR) ? 1 : 0);
    chip.hidden = false;
    chip.textContent = `${current.tagName.toLowerCase()} · ${count} field${count === 1 ? "" : "s"} · click to pick · ↑↓ resize · Esc`;
    chip.style.top = `${Math.max(r.top, 22)}px`;
    chip.style.left = `${Math.max(r.left, 4)}px`;
  };

  // Every listener is wrapped: a throw in one hover/scroll tick (a page that
  // booby-traps `getBoundingClientRect`, a node detached mid-frame) must not
  // kill the picker or leave the overlay stuck on screen.
  const guard =
    <A extends unknown[]>(fn: (...args: A) => void) =>
    (...args: A) => {
      try {
        fn(...args);
      } catch {
        /* swallow — a single bad frame is not worth tearing the picker down */
      }
    };

  const onMove = guard((e: MouseEvent) => {
    const el = deepElementFromPoint(e.clientX, e.clientY);
    if (!el || host.contains(el)) return;
    current = el;
    paint();
  });

  const swallow = (e: Event) => {
    e.stopImmediatePropagation();
  };

  const onClick = guard((e: MouseEvent) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const el = current ?? deepElementFromPoint(e.clientX, e.clientY);
    if (!el) {
      finish({ cancelled: true });
      return;
    }
    try {
      const { picked, blockText, semanticCount } = decomposeContainer(el);
      finish({ cancelled: false, picked, blockText, semanticCount });
    } catch {
      // Decompose blew up on this block (exotic shadow DOM, a getter that
      // throws). Don't wedge the loop — end this pick cleanly; the user can
      // pick again or widen the selection.
      finish({ cancelled: false, picked: [], blockText: "", semanticCount: 0 });
    }
  });

  const onKey = guard((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish({ cancelled: true });
      return;
    }
    if (!current) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const parent = current.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        current = parent;
        paint();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const child = Array.from(current.children).find(
        (c): c is HTMLElement => c instanceof HTMLElement && c.getClientRects().length > 0,
      );
      if (child) {
        current = child;
        paint();
      }
    }
  });

  const reposition = guard(() => paint());

  const finish = (outcome: PickerOutcome) => {
    if (done) return;
    done = true;
    teardown();
    resolve(outcome);
  };

  const teardown = () => {
    if (activeTeardown === teardown) activeTeardown = null;
    try {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mousedown", swallow, true);
      document.removeEventListener("pointerdown", swallow, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition, true);
      host.remove();
    } catch {
      /* best-effort cleanup — the Promise still resolves either way */
    }
  };

  activeTeardown = teardown;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("pointerdown", swallow, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", reposition, true);
  window.addEventListener("resize", reposition, true);
}
