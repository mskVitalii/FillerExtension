import { isOverlayHostNode, isOverlayNode } from "./overlay-host";

/**
 * Keeps freshly written values in place while a React/SPA form settles.
 *
 * A fill can be lost right after it "worked": the framework remounts the
 * form (new session id, a step transition, async data arriving) and swaps
 * the node we wrote into for an empty one, or re-renders a controlled
 * input from state that never saw our value. Neither raises an error, the
 * field just goes blank a moment later.
 *
 * Each guarded fill carries a way to find its field again (`locate`, by
 * label/name/autocomplete/position, never the node itself) and to write the
 * value again (`refill`). After any page mutation (debounced) and at a few
 * fixed checkpoints (a reset of `.value` causes no mutation at all), every
 * field is checked. One that is empty again, or back to what it held
 * before we filled it, is refilled.
 *
 * What stops this from ever looping:
 * - mutations caused by our own refill are dropped (`takeRecords()` right
 *   after writing), and so are mutations inside our overlay;
 * - checks are debounced, so a re-render storm costs one check;
 * - each field is refilled at most `maxRetries` times;
 * - a field the user typed into (a trusted `input`) is never touched again;
 * - the observer disconnects once every field held its value through a
 *   quiet period, after `timeoutMs` regardless, or on SPA navigation.
 *
 * A value that differs but isn't empty (an input mask that reformatted the
 * phone number, a combobox showing its label) counts as kept: the guard
 * only undoes a reset, it never fights a site's formatting.
 */

export interface GuardedFill {
  /** The node we wrote into. */
  el: HTMLElement;
  /** Finds the field again after it was replaced. `null` while it's absent. */
  locate: () => HTMLElement | null;
  /** Writes the value into `el` again. */
  refill: (el: HTMLElement) => boolean | Promise<boolean>;
  /** What the field held before the first fill. Normalized like `readValue`. */
  before: string;
}

export interface GuardOptions {
  timeoutMs?: number;
  debounceMs?: number;
  maxRetries?: number;
  /** How long the page must stay quiet, all values in place, before the guard stops early. */
  settleMs?: number;
  /** Extra checks with no mutation at all, in ms after start (catches a controlled `.value` reset). */
  checkpointsMs?: number[];
}

export interface GuardReport {
  refills: number;
  /** Fields still empty/reverted when the guard stopped. */
  lost: number;
}

const DEFAULTS: Required<GuardOptions> = {
  timeoutMs: 6000,
  debounceMs: 150,
  maxRetries: 2,
  settleMs: 1200,
  checkpointsMs: [250, 1000, 2500],
};

/** The field's current value, normalized for comparison. */
export function readValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim();
  }
  return (el.textContent ?? "").trim();
}

interface Tracked extends GuardedFill {
  retries: number;
  userOwned: boolean;
}

const active = new Set<() => void>();

/** Stops every running guard (navigation away, a new autofill run, tests). */
export function stopFillGuards(): void {
  for (const stop of [...active]) stop();
}

export function guardFills(fills: GuardedFill[], options: GuardOptions = {}): Promise<GuardReport> {
  const opts = { ...DEFAULTS, ...options };
  const tracked: Tracked[] = fills.map((f) => ({ ...f, retries: 0, userOwned: false }));
  if (tracked.length === 0) return Promise.resolve({ refills: 0, lost: 0 });

  return new Promise<GuardReport>((resolve) => {
    const startUrl = location.href;
    const startedAt = Date.now();
    // Settling early must not skip a checkpoint: a controlled `.value` reset
    // makes no mutation, so only a checkpoint would ever notice it.
    const earliestStop = startedAt + Math.max(0, ...opts.checkpointsMs);
    const timers: ReturnType<typeof setTimeout>[] = [];
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let settle: ReturnType<typeof setTimeout> | null = null;
    let refills = 0;
    let busy = false;
    let pendingWhileBusy = false;
    let stopped = false;

    const current = (t: Tracked): HTMLElement | null => {
      if (t.el.isConnected) return t.el;
      const found = t.locate();
      if (found) t.el = found;
      return found;
    };

    const isLost = (t: Tracked, el: HTMLElement): boolean => {
      const value = readValue(el);
      return value === "" || (t.before !== "" && value === t.before);
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      active.delete(stop);
      observer.disconnect();
      document.removeEventListener("input", onUserInput, true);
      for (const timer of timers) clearTimeout(timer);
      if (debounce) clearTimeout(debounce);
      if (settle) clearTimeout(settle);
      let lost = 0;
      for (const t of tracked) {
        if (t.userOwned) continue;
        const el = current(t);
        if (!el || isLost(t, el)) lost++;
      }
      resolve({ refills, lost });
    };

    const check = async () => {
      if (stopped) return;
      if (location.href !== startUrl) {
        stop();
        return;
      }
      if (busy) {
        pendingWhileBusy = true;
        return;
      }
      busy = true;
      let allKept = true;
      try {
        for (const t of tracked) {
          if (t.userOwned) continue;
          const el = current(t);
          if (!el) {
            // Mid-remount: the replacement may not be in the DOM yet. The
            // next mutation (or checkpoint) looks again.
            if (t.retries < opts.maxRetries) allKept = false;
            continue;
          }
          if (!isLost(t, el)) continue;
          if (t.retries >= opts.maxRetries) continue;
          t.retries++;
          refills++;
          allKept = false;
          try {
            await t.refill(el);
          } catch {
            /* one field's refill failing must not end the guard for the others */
          }
          // Our own write just queued mutations; drop them so they don't
          // schedule another check of their own.
          observer.takeRecords();
        }
      } finally {
        busy = false;
      }
      if (stopped) return;
      if (pendingWhileBusy) {
        pendingWhileBusy = false;
        schedule();
        return;
      }
      // Out of retries everywhere, or everything held: wind down after a
      // quiet period (any later mutation re-checks first, which then does no
      // refills for an exhausted field, so this can only end).
      const exhausted = tracked.every((t) => t.userOwned || t.retries >= opts.maxRetries);
      if (allKept || exhausted) {
        if (settle) clearTimeout(settle);
        settle = setTimeout(stop, Math.max(opts.settleMs, earliestStop - Date.now() + 50));
      }
    };

    const schedule = () => {
      if (stopped) return;
      if (settle) {
        clearTimeout(settle);
        settle = null;
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void check();
      }, opts.debounceMs);
    };

    const observer = new MutationObserver((records) => {
      if (busy) return;
      // Our overlay (picker box, field highlights) mounting or being put back
      // is not the page re-rendering.
      const ours = (r: MutationRecord) =>
        isOverlayNode(r.target) ||
        (r.addedNodes.length + r.removedNodes.length > 0 &&
          [...r.addedNodes, ...r.removedNodes].every((n) => isOverlayNode(n) || isOverlayHostNode(n)));
      if (records.every(ours)) return;
      schedule();
    });

    const onUserInput = (event: Event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      for (const t of tracked) {
        if (target instanceof Node && (t.el === target || t.el.contains(target))) t.userOwned = true;
      }
    };

    active.add(stop);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener("input", onUserInput, true);
    for (const at of opts.checkpointsMs) timers.push(setTimeout(() => void check(), at));
    timers.push(setTimeout(stop, opts.timeoutMs));
  });
}
