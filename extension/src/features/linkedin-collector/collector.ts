import { extractLinkedIn } from "@/features/job-extraction/sites/linkedin";
import { PICKER_GRADIENT } from "@/lib/brand-gradient";
import { sendMessage, type MessageOf, type RuntimeMessage } from "@/types/messages";
import { findApplyLink } from "./apply-link";
import {
  DETAILS_SELECTOR,
  dedupeJobLinks,
  findJobCards,
  isRenderedCard,
  jobIdFromHref,
  linkedInPageKind,
  readCard,
  scanJobCards,
  type LinkedInJobLink,
  type LinkedInPageKind,
  type PageScan,
} from "./links";

/**
 * The on-page LinkedIn collector, on LinkedIn's job search, collection and single-posting pages:
 *  - "Apply via Filler AI", right of the selected job's own "Apply ↗": keeps the job and queues the
 *    employer's link behind that button in the local agent (agent-handoff.ts). Not shown for Easy
 *    Apply — Filler never applies on LinkedIn;
 *  - "+ Add all (N)" in the results list's header row: the jobs on screen that apply off LinkedIn;
 *  - a small "+ Add" on each such card.
 * Registered as its own content script only after the user switched it on (`registration.ts`).
 *
 * LinkedIn bans accounts it takes for bots, and the user's account is worth more than any job link.
 * So this script only ever READS what LinkedIn has already rendered, and only on a click:
 *  - no request to LinkedIn of any kind (no API/voyager calls, no fetch of a LinkedIn page);
 *  - no click, focus, scroll, keypress or form submit on LinkedIn's own elements; no Easy Apply;
 *    the Apply link's href is read, never followed;
 *  - no polling: one MutationObserver (debounced) to re-read the page and re-attach the host, plus
 *    passive scroll/resize listeners to keep the buttons on their places;
 *  - one host element (a custom element in the top layer, closed shadow root), nothing put inside
 *    LinkedIn's own markup, and no `web_accessible_resources` a page could probe for.
 * The list is virtualized: what isn't rendered isn't collected — the status says to scroll or open
 * the next page instead of doing it.
 */

const HOST_TAG = "filler-linkedin";
const MUTATION_DEBOUNCE_MS = 400;
const TOAST_MS = 9000;

declare global {
  interface Window {
    /**
     * Manual test page only (`test-pages/linkedin-jobs-test.html`): the LinkedIn URL the page
     * pretends to be. A content script runs in its own isolated world, so nothing a real page sets
     * on `window` can reach this — on LinkedIn it's always undefined.
     */
    __fillerLinkedInTestHref?: string;
  }
}

function pageHref(): string {
  // `typeof`, not `??`: a page element with that id would show up here through named access.
  const test = window.__fillerLinkedInTestHref;
  return typeof test === "string" ? test : location.href;
}

const STRINGS = {
  en: {
    addAll: (n: number) => `+ Add all (${n})`,
    add: "Add",
    added: "Added",
    agent: "Apply via Filler AI",
    agentSending: "Sending to the agent…",
    result: (added: number, total: number) => (added > 0 ? `Added ${added} new · ${total} in Filler.` : `Nothing new · ${total} in Filler.`),
    skipped: (easy: number, notLoaded: number) =>
      [easy ? `${easy} Easy Apply skipped` : "", notLoaded ? `${notLoaded} not loaded yet — scroll or open the next page to collect more` : ""].filter(Boolean).join(" · "),
    none: "No jobs with an employer link on screen — Easy Apply ones are skipped. Scroll to load more.",
    stale: "Filler was updated — reload this page to use it here.",
    failed: "Couldn't save: ",
    close: "Hide until the next page",
  },
  de: {
    addAll: (n: number) => `+ Alle hinzufügen (${n})`,
    add: "Hinzufügen",
    added: "Hinzugefügt",
    agent: "Mit Filler KI bewerben",
    agentSending: "Wird an den Agenten gesendet…",
    result: (added: number, total: number) => (added > 0 ? `${added} neu hinzugefügt · ${total} in Filler.` : `Nichts Neues · ${total} in Filler.`),
    skipped: (easy: number, notLoaded: number) =>
      [easy ? `${easy} Easy Apply übersprungen` : "", notLoaded ? `${notLoaded} noch nicht geladen — scrolle oder öffne die nächste Seite, um mehr zu sammeln` : ""].filter(Boolean).join(" · "),
    none: "Keine Jobs mit Arbeitgeber-Link auf dem Bildschirm — Easy Apply wird übersprungen. Scrolle, um mehr zu laden.",
    stale: "Filler wurde aktualisiert — lade die Seite neu, um es hier zu nutzen.",
    failed: "Speichern fehlgeschlagen: ",
    close: "Bis zur nächsten Seite ausblenden",
  },
  ru: {
    addAll: (n: number) => `+ Добавить все (${n})`,
    add: "Добавить",
    added: "Добавлено",
    agent: "Откликнуться через Filler AI",
    agentSending: "Отправляю агенту…",
    result: (added: number, total: number) => (added > 0 ? `Добавлено новых: ${added} · всего в Filler: ${total}.` : `Новых нет · всего в Filler: ${total}.`),
    skipped: (easy: number, notLoaded: number) =>
      [easy ? `пропущено Easy Apply: ${easy}` : "", notLoaded ? `ещё не загружено: ${notLoaded} — прокрутите или откройте следующую страницу, чтобы собрать больше` : ""].filter(Boolean).join(" · "),
    none: "На экране нет вакансий со ссылкой работодателя — Easy Apply пропускаются. Прокрутите, чтобы загрузить ещё.",
    stale: "Filler обновился — перезагрузите страницу, чтобы пользоваться им здесь.",
    failed: "Не удалось сохранить: ",
    close: "Скрыть до следующей страницы",
  },
};

function strings() {
  for (const language of navigator.languages ?? [navigator.language]) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "de" || base === "ru") return STRINGS[base];
  }
  return STRINGS.en;
}

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
button { all: unset; box-sizing: border-box; cursor: pointer; font: 600 12px/1 system-ui, -apple-system, "Segoe UI", sans-serif; }
:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
.addall {
  position: fixed; pointer-events: auto; display: flex; align-items: center; border-radius: 999px;
  background: #ffffff; border: 1px solid #0a66c2; box-shadow: 0 1px 4px rgba(0,0,0,.15); overflow: hidden;
}
.addall .primary { padding: 7px 10px 7px 12px; color: #0a66c2; }
.addall .primary:hover, .addall .close:hover { background: #eef3f8; }
.addall .primary:disabled { opacity: .6; cursor: default; }
.addall .close { color: #555; font-size: 14px; padding: 6px 9px; border-left: 1px solid #d0dbe6; }
.agent {
  position: fixed; pointer-events: auto; display: inline-flex; align-items: center; justify-content: center;
  padding: 0 16px; min-height: 32px; border-radius: 999px; color: #ffffff; font-size: 14px; font-weight: 600; white-space: nowrap;
  background: ${PICKER_GRADIENT}; box-shadow: 0 0 0 0 rgba(168,85,247,.55); animation: glow 2.4s ease-in-out infinite;
}
.agent:hover { filter: brightness(1.08); }
.agent:disabled { opacity: .75; cursor: default; animation: none; }
@keyframes glow { 0%,100% { box-shadow: 0 0 0 0 rgba(168,85,247,.0); } 50% { box-shadow: 0 0 14px 2px rgba(168,85,247,.55); } }
@media (prefers-reduced-motion: reduce) { .agent { animation: none; } }
.toast {
  position: fixed; pointer-events: auto; max-width: 340px; padding: 8px 10px; border-radius: 8px;
  font: 12px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827; background: #ffffff;
  border: 1px solid #d1d5db; box-shadow: 0 4px 16px rgba(0,0,0,.16);
}
.toast.error { border-color: #fca5a5; background: #fef2f2; color: #7f1d1d; }
.toast[hidden], .addall[hidden], .agent[hidden] { display: none; }
.card {
  position: fixed; pointer-events: auto; font-size: 11px; padding: 5px 8px; border-radius: 999px;
  background: #ffffff; color: #0a66c2; border: 1px solid #0a66c2; box-shadow: 0 1px 3px rgba(0,0,0,.12);
}
.card:hover { background: #eef3f8; }
.card.added { background: #ecfdf5; color: #047857; border-color: #6ee7b7; cursor: default; }
`;

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
  "z-index": "2147483646",
  "pointer-events": "none",
  visibility: "visible",
  opacity: "1",
  transform: "none",
  filter: "none",
  contain: "none",
};

/** The selected job of a search page (its details pane) or the posting of a `/jobs/view/` page. */
export function currentJob(doc: Document, href: string): LinkedInJobLink | null {
  const id = jobIdFromHref(href);
  if (!id) return null;
  const details = extractLinkedIn(doc, href);
  return {
    id,
    url: `https://www.linkedin.com/jobs/view/${id}/`,
    title: details?.position ?? "",
    company: details?.company ?? "",
    location: details?.location ?? "",
  };
}

/** What "Add all" takes on a list page: the rendered, non-Easy-Apply cards, the selected job's pane filling its own card's gaps. */
export function jobsForPage(doc: Document, href: string): PageScan {
  const scan = scanJobCards(doc);
  const selected = currentJob(doc, href);
  if (selected && scan.jobs.some((job) => job.id === selected.id)) scan.jobs = dedupeJobLinks([...scan.jobs, selected]);
  return scan;
}

function nonEmpty(link: LinkedInJobLink): Partial<LinkedInJobLink> {
  return Object.fromEntries(Object.entries(link).filter(([, value]) => value)) as Partial<LinkedInJobLink>;
}

/** "239 results" above LinkedIn's job list — where the "Add all" button sits. */
const RESULTS_RE = /^\s*[\d\s.,]+\+?\s*(?:results?|Ergebnisse|результат\w*|résultats|resultados|risultati)\s*$/i;

function findResultsHeader(doc: Document): Element | null {
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!RESULTS_RE.test(node.textContent ?? "")) continue;
    const el = node.parentElement;
    if (el && !el.closest(DETAILS_SELECTOR)) return el;
  }
  return null;
}

interface Collector {
  stop(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  if (node instanceof HTMLButtonElement) node.type = "button";
  return node;
}

function startCollector(): Collector {
  const t = strings();
  const collected = new Set<string>();
  /** Per job id: what the agent said after "Apply via Filler AI". */
  const agentState = new Map<string, "sending" | "done">();
  let kind: LinkedInPageKind = null;
  let dismissedFor = "";
  let stale = false;

  const host = document.createElement(HOST_TAG);
  for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, "important");
  host.setAttribute("popover", "manual");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;

  const addAll = el("div", "addall");
  addAll.setAttribute("role", "group");
  addAll.setAttribute("aria-label", "Filler");
  const primary = el("button", "primary");
  const close = el("button", "close", "×");
  close.title = t.close;
  close.setAttribute("aria-label", t.close);
  addAll.append(primary, close);
  const agent = el("button", "agent", `✦ ${t.agent}`);
  const toast = el("div", "toast");
  toast.setAttribute("role", "status");
  toast.hidden = true;
  const cardLayer = el("div", "cards");
  shadow.append(style, cardLayer, addAll, agent, toast);

  const cardButtons = new Map<string, HTMLButtonElement>();
  const scrollParents = new WeakMap<Element, Element | null>();
  /** Re-read on every (debounced) page change, not on scroll. */
  let cards: { id: string; card: Element }[] = [];
  let apply: { link: HTMLElement; url: string } | null = null;
  let header: Element | null = null;
  /** Ids "+ Add all" would take: rendered, not Easy Apply (by any of the job's cards). */
  let eligible = new Set<string>();

  // Our clicks stay ours: LinkedIn's document-level handlers never see them as clicks on its page.
  for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown"]) {
    shadow.addEventListener(type, (event) => event.stopPropagation());
  }

  const showInTopLayer = () => {
    const popover = host as HTMLElement & { showPopover?: () => void };
    try {
      if (typeof popover.showPopover === "function" && !host.matches(":popover-open")) popover.showPopover();
    } catch {
      /* not connected / no popover support: the fixed, max z-index host still shows */
    }
  };
  const attach = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
    showInTopLayer();
  };

  let toastAnchor: "addall" | "agent" = "addall";
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const showToast = (text: string, anchor: "addall" | "agent", error = false) => {
    toast.textContent = text;
    toast.classList.toggle("error", error);
    toast.hidden = false;
    toastAnchor = anchor;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, TOAST_MS);
    schedule();
  };

  const isStale = (err: unknown) => /context invalidated|receiving end/i.test((err as Error)?.message ?? "");

  const send = async (jobs: LinkedInJobLink[]): Promise<MessageOf<"LINKEDIN_JOBS_ADDED"> | null> => {
    try {
      const reply = await sendMessage<MessageOf<"LINKEDIN_JOBS_ADDED">>({ type: "LINKEDIN_ADD_JOBS", jobs });
      reply.ids.forEach((id) => collected.add(id));
      return reply;
    } catch (err) {
      stale ||= isStale(err);
      showToast(stale ? t.stale : t.failed + (err as Error).message, "addall", true);
      return null;
    }
  };

  const refreshCollected = async () => {
    try {
      const reply = await sendMessage<MessageOf<"LINKEDIN_COLLECTED">>({ type: "GET_LINKEDIN_COLLECTED" });
      collected.clear();
      reply.ids.forEach((id) => collected.add(id));
      schedule();
    } catch {
      /* extension reloaded — the buttons still show, and a click says to reload */
    }
  };

  primary.addEventListener("click", async () => {
    if (stale) return showToast(t.stale, "addall", true);
    const scan = jobsForPage(document, pageHref());
    const skipped = t.skipped(scan.easyApply, scan.notLoaded);
    if (scan.jobs.length === 0) return showToast([t.none, skipped].filter(Boolean).join(" "), "addall");
    primary.disabled = true;
    const reply = await send(scan.jobs);
    primary.disabled = false;
    if (reply) showToast([t.result(reply.added, reply.total), skipped].filter(Boolean).join(" "), "addall");
  });

  close.addEventListener("click", () => {
    dismissedFor = pageHref();
    schedule();
  });

  agent.addEventListener("click", async () => {
    if (stale) return showToast(t.stale, "agent", true);
    const job = currentJob(document, pageHref());
    const link = findApplyLink(document);
    if (!job || !link || agentState.get(job.id) === "sending") return;
    const card = cards.find((c) => c.id === job.id);
    const full = card ? { ...readCard(card.card, job.id), ...nonEmpty(job) } : job;
    agentState.set(job.id, "sending");
    agent.disabled = true;
    showToast(t.agentSending, "agent");
    try {
      const reply = await sendMessage<MessageOf<"LINKEDIN_AGENT_RESULT">>({
        type: "LINKEDIN_APPLY_VIA_AGENT",
        job: full,
        applyUrl: link.url,
        description: extractLinkedIn(document, pageHref())?.description ?? "",
      });
      collected.add(job.id);
      if (reply.ok) agentState.set(job.id, "done");
      else agentState.delete(job.id);
      showToast(reply.message, "agent", !reply.ok);
    } catch (err) {
      agentState.delete(job.id);
      stale ||= isStale(err);
      showToast(stale ? t.stale : (err as Error).message, "agent", true);
    } finally {
      agent.disabled = false;
      schedule();
    }
  });

  cardLayer.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-id]");
    const id = button?.dataset.id;
    if (!button || !id || collected.has(id) || stale) return;
    const entry = cards.find((c) => c.id === id);
    if (!entry) return;
    const job = readCard(entry.card, id);
    const selected = currentJob(document, pageHref());
    const reply = await send([selected?.id === id ? { ...job, ...nonEmpty(selected) } : job]);
    if (reply) showToast(t.result(reply.added, reply.total), "addall");
    schedule();
  });

  /** The element whose own scrollbar moves this element (a results or details column), for clipping. */
  const scrollParentOf = (node: Element): Element | null => {
    if (scrollParents.has(node)) return scrollParents.get(node) ?? null;
    let found: Element | null = null;
    for (let p = node.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const overflow = getComputedStyle(p).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) {
        found = p;
        break;
      }
    }
    scrollParents.set(node, found);
    return found;
  };
  const clipOf = (node: Element) => {
    const clip = scrollParentOf(node)?.getBoundingClientRect();
    return {
      top: Math.max(clip?.top ?? 0, 0),
      bottom: Math.min(clip?.bottom ?? innerHeight, innerHeight),
      left: Math.max(clip?.left ?? 0, 0),
      right: Math.min(clip?.right ?? innerWidth, innerWidth),
    };
  };
  const place = (node: HTMLElement, box: { top?: number; left?: number; right?: number; bottom?: number; height?: number }) => {
    for (const side of ["top", "left", "right", "bottom"] as const) node.style[side] = box[side] === undefined ? "" : `${Math.round(box[side]!)}px`;
    node.style.height = box.height === undefined ? "" : `${Math.round(box.height)}px`;
  };

  const placeAddAll = (): DOMRect | null => {
    const show = kind === "list" && dismissedFor !== pageHref() && cards.length > 0;
    addAll.hidden = !show;
    if (!show) return null;
    primary.textContent = t.addAll(eligible.size);
    // In the list's header row ("239 results"), right-aligned to the list column; else bottom-left,
    // away from LinkedIn's messaging dock (bottom-right).
    const headerRect = header?.isConnected ? header.getBoundingClientRect() : null;
    let column: Element | null = header;
    while (column && column.getBoundingClientRect().width < 280) column = column.parentElement;
    if (headerRect && headerRect.height > 0 && headerRect.top >= 0 && headerRect.bottom <= innerHeight && column) {
      // Beside the "N results" text, never over it: after it when the column has room, else before it.
      const columnRect = column.getBoundingClientRect();
      const width = addAll.getBoundingClientRect().width || 170;
      const top = headerRect.top + headerRect.height / 2 - 15;
      if (headerRect.right + 10 + width <= columnRect.right - 8) place(addAll, { top, left: headerRect.right + 10 });
      else place(addAll, { top, right: innerWidth - headerRect.left + 10 });
    } else {
      place(addAll, { left: 16, bottom: 16 });
    }
    return addAll.getBoundingClientRect();
  };

  const placeAgent = (): DOMRect | null => {
    const link = apply?.link;
    const job = currentJob(document, pageHref());
    const rect = link?.isConnected ? link.getBoundingClientRect() : null;
    const clip = link ? clipOf(link) : null;
    const visible = Boolean(kind && job && rect && clip && rect.height > 0 && rect.top >= clip.top && rect.bottom <= clip.bottom);
    agent.hidden = !visible;
    if (!visible || !rect || !link) return null;
    // Right of everything on Apply's row (Apply, Save, …).
    let rowRight = rect.right;
    const row = link.parentElement?.parentElement?.parentElement ?? link.parentElement;
    for (const other of row?.querySelectorAll("a, button") ?? []) {
      const r = other.getBoundingClientRect();
      if (r.width > 0 && r.width < 400 && Math.abs(r.top + r.height / 2 - (rect.top + rect.height / 2)) < 8 && r.left >= rect.left) rowRight = Math.max(rowRight, r.right);
    }
    const done = agentState.get(job!.id) === "done";
    agent.textContent = done ? `✓ ${t.agent}` : `✦ ${t.agent}`;
    place(agent, { top: rect.top, left: rowRight + 10, height: rect.height });
    return agent.getBoundingClientRect();
  };

  const placeCards = (avoid: (DOMRect | null)[]) => {
    const shown = new Set<string>();
    if (kind && dismissedFor !== pageHref()) {
      for (const { id, card } of cards) {
        if (shown.has(id) || !eligible.has(id) || !card.isConnected || !isRenderedCard(card)) continue;
        const rect = card.getBoundingClientRect();
        if (rect.height < 40 || rect.width < 120) continue;
        const clip = clipOf(card);
        const top = rect.bottom - 30;
        const right = rect.right - 8;
        if (top < clip.top || top + 24 > clip.bottom || right > clip.right || right - 90 < clip.left) continue;
        if (avoid.some((r) => r && top + 24 > r.top && top < r.bottom && right > r.left && right - 90 < r.right)) continue;
        let button = cardButtons.get(id);
        if (!button) {
          button = el("button", "card");
          button.dataset.id = id;
          cardButtons.set(id, button);
          cardLayer.append(button);
        }
        const state = collected.has(id) ? "added" : "new";
        if (button.dataset.state !== state) {
          button.dataset.state = state;
          button.classList.toggle("added", state === "added");
          button.textContent = state === "added" ? `✓ ${t.added}` : `+ ${t.add}`;
          button.setAttribute("aria-label", `${state === "added" ? t.added : t.add}: ${readCard(card, id).title || id}`);
        }
        place(button, { top, right: innerWidth - right });
        button.hidden = false;
        shown.add(id);
      }
    }
    for (const [id, button] of cardButtons) if (!shown.has(id)) button.hidden = true;
  };

  const placeToast = (addAllRect: DOMRect | null, agentRect: DOMRect | null) => {
    if (toast.hidden) return;
    const anchor = toastAnchor === "agent" ? agentRect : addAllRect;
    if (!anchor) {
      place(toast, { left: 16, bottom: 64 });
      return;
    }
    const left = Math.max(8, Math.min(anchor.left, innerWidth - 348));
    if (anchor.bottom + 120 < innerHeight) place(toast, { top: anchor.bottom + 6, left });
    else place(toast, { bottom: innerHeight - anchor.top + 6, left });
  };

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const addAllRect = placeAddAll();
      const agentRect = placeAgent();
      placeCards([addAllRect, agentRect]);
      placeToast(addAllRect, agentRect);
    });
  };

  /** Re-reads the page: the cards, the selected job's Apply link, the list header. */
  const reread = () => {
    cards = findJobCards(document);
    eligible = new Set(scanJobCards(document).jobs.map((job) => job.id));
    apply = findApplyLink(document);
    header = kind === "list" ? findResultsHeader(document) : null;
  };

  const render = () => {
    kind = linkedInPageKind(pageHref());
    if (!kind) {
      host.remove();
      cards = [];
      apply = null;
      return;
    }
    attach();
    reread();
    schedule();
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (!kind) return;
      if (!host.isConnected) attach();
      reread();
      schedule();
    }, MUTATION_DEBOUNCE_MS);
  });

  let lastHref = pageHref();
  const onNavigate = () => {
    if (pageHref() === lastHref) return;
    lastHref = pageHref();
    toast.hidden = true;
    render();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && kind) void refreshCollected();
  };
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  const onScroll = () => schedule();

  observer.observe(document.documentElement, { childList: true, subtree: true });
  nav?.addEventListener("navigatesuccess", onNavigate);
  addEventListener("popstate", onNavigate);
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  addEventListener("resize", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisible);

  render();
  void refreshCollected();

  return {
    stop() {
      observer.disconnect();
      if (debounce) clearTimeout(debounce);
      if (toastTimer) clearTimeout(toastTimer);
      if (frame) cancelAnimationFrame(frame);
      nav?.removeEventListener("navigatesuccess", onNavigate);
      removeEventListener("popstate", onNavigate);
      document.removeEventListener("scroll", onScroll, { capture: true });
      removeEventListener("resize", onScroll);
      document.removeEventListener("visibilitychange", onVisible);
      host.remove();
    },
  };
}

declare global {
  interface Window {
    __fillerLinkedInCollector?: Collector;
  }
}

/** Entry point: once per page, even when injected again into a tab that already has it. */
export function bootLinkedInCollector(): void {
  if (window.__fillerLinkedInCollector) return;
  const collector = startCollector();
  window.__fillerLinkedInCollector = collector;
  chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
    if (message.type !== "LINKEDIN_COLLECTOR_OFF") return false;
    collector.stop();
    window.__fillerLinkedInCollector = undefined;
    return false;
  });
}
