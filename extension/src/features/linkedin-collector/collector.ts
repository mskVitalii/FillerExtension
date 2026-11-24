import { extractLinkedIn } from "@/features/job-extraction/sites/linkedin";
import { sendMessage, type MessageOf, type RuntimeMessage } from "@/types/messages";
import { collectJobLinks, dedupeJobLinks, findJobCards, jobIdFromHref, linkedInPageKind, readCard, type LinkedInJobLink, type LinkedInPageKind } from "./links";

/**
 * The on-page LinkedIn collector: an "Add all jobs from this page" button and a small "Add" on each
 * job card, on LinkedIn's job search, collection and single-posting pages. Registered as its own
 * content script only after the user switched it on in the Side Panel (`registration.ts`).
 *
 * LinkedIn bans accounts it takes for bots, and the user's account is worth more than any job link.
 * So this script only ever READS what LinkedIn has already rendered, and only on a click:
 *  - no request to LinkedIn of any kind (no API/voyager calls, no fetch of a LinkedIn page);
 *  - no click, focus, scroll, keypress or form submit on LinkedIn's own elements; no Easy Apply;
 *  - no polling: one MutationObserver (debounced) to place the per-card buttons and re-attach the
 *    host, plus passive scroll/resize listeners to keep the buttons on their cards;
 *  - one host element (a custom element in the top layer, closed shadow root), nothing put inside
 *    LinkedIn's own markup, and no `web_accessible_resources` a page could probe for.
 * The list is virtualized: what isn't rendered isn't collected — the panel says to scroll or open
 * the next page instead of doing it.
 */

const HOST_TAG = "filler-linkedin";

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
const MUTATION_DEBOUNCE_MS = 400;

const STRINGS = {
  en: {
    addAll: "Add all jobs from this page",
    addThis: "Add this job",
    add: "Add",
    added: "Added",
    found: (n: number) => `${n} found on this page; scroll or open the next page to collect more.`,
    result: (added: number, total: number) => (added > 0 ? `Added ${added} new · ${total} collected in Filler.` : `Nothing new · ${total} collected in Filler.`),
    none: "No job links rendered on this page yet — scroll the list first.",
    stale: "Filler was updated — reload this page to use it here.",
    failed: "Couldn't save: ",
    close: "Hide until the next page",
  },
  de: {
    addAll: "Alle Jobs dieser Seite hinzufügen",
    addThis: "Diesen Job hinzufügen",
    add: "Hinzufügen",
    added: "Hinzugefügt",
    found: (n: number) => `${n} auf dieser Seite gefunden; scrolle oder öffne die nächste Seite, um mehr zu sammeln.`,
    result: (added: number, total: number) => (added > 0 ? `${added} neu hinzugefügt · ${total} in Filler gesammelt.` : `Nichts Neues · ${total} in Filler gesammelt.`),
    none: "Auf dieser Seite sind noch keine Job-Links geladen — scrolle zuerst durch die Liste.",
    stale: "Filler wurde aktualisiert — lade die Seite neu, um es hier zu nutzen.",
    failed: "Speichern fehlgeschlagen: ",
    close: "Bis zur nächsten Seite ausblenden",
  },
  ru: {
    addAll: "Добавить все вакансии со страницы",
    addThis: "Добавить эту вакансию",
    add: "Добавить",
    added: "Добавлено",
    found: (n: number) => `На странице найдено: ${n}; прокрутите список или откройте следующую страницу, чтобы собрать ещё.`,
    result: (added: number, total: number) => (added > 0 ? `Добавлено новых: ${added} · всего в Filler: ${total}.` : `Новых нет · всего в Filler: ${total}.`),
    none: "На странице ещё нет ссылок на вакансии — сначала прокрутите список.",
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
.panel {
  position: fixed; right: 16px; bottom: 16px; max-width: 300px; pointer-events: auto;
  font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111827;
  background: #ffffff; border: 1px solid #d1d5db; border-radius: 10px; padding: 10px 12px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18); display: flex; flex-direction: column; gap: 6px;
}
.row { display: flex; align-items: center; gap: 8px; }
.brand { font-weight: 600; font-size: 12px; color: #6b7280; flex: 1; }
.close { all: unset; cursor: pointer; color: #6b7280; font-size: 16px; line-height: 1; padding: 0 2px; }
.close:hover { color: #111827; }
.primary {
  all: unset; cursor: pointer; text-align: center; padding: 7px 10px; border-radius: 7px;
  background: #111827; color: #ffffff; font-weight: 600;
}
.primary:hover { background: #374151; }
.primary:disabled { opacity: .6; cursor: default; }
.status { color: #374151; font-size: 12px; }
.status:empty { display: none; }
.card {
  all: unset; position: fixed; pointer-events: auto; cursor: pointer; box-sizing: border-box;
  font: 600 11px/1 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 5px 8px; border-radius: 999px;
  background: #ffffff; color: #111827; border: 1px solid #9ca3af; box-shadow: 0 1px 3px rgba(0,0,0,.15);
}
.card:hover { border-color: #111827; }
.card.added { background: #ecfdf5; color: #047857; border-color: #6ee7b7; cursor: default; }
:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1f2937; color: #f9fafb; border-color: #4b5563; }
  .brand, .close { color: #9ca3af; }
  .close:hover { color: #f9fafb; }
  .primary { background: #f9fafb; color: #111827; }
  .primary:hover { background: #e5e7eb; }
  .status { color: #d1d5db; }
  .card { background: #1f2937; color: #f9fafb; border-color: #6b7280; }
  .card.added { background: #064e3b; color: #a7f3d0; border-color: #047857; }
}
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

/** What "Add all" collects: every card on a list page, with the selected job's details pane filling its card's gaps; the posting itself on a view page. */
export function jobsForPage(doc: Document, href: string, kind: LinkedInPageKind): LinkedInJobLink[] {
  const selected = currentJob(doc, href);
  if (kind === "view") return selected ? [selected] : [];
  const cards = collectJobLinks(doc);
  // The pane's job only fills its own card's empty fields — it isn't added when its card isn't listed.
  return selected && cards.some((card) => card.id === selected.id) ? dedupeJobLinks([...cards, selected]) : cards;
}

function nonEmpty(link: LinkedInJobLink): Partial<LinkedInJobLink> {
  return Object.fromEntries(Object.entries(link).filter(([, value]) => value)) as Partial<LinkedInJobLink>;
}

interface Collector {
  stop(): void;
}

function startCollector(): Collector {
  const t = strings();
  const collected = new Set<string>();
  let kind: LinkedInPageKind = null;
  let dismissedFor = "";
  let stale = false;

  const host = document.createElement(HOST_TAG);
  for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, "important");
  host.setAttribute("popover", "manual");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Filler");
  const head = document.createElement("div");
  head.className = "row";
  const brand = document.createElement("span");
  brand.className = "brand";
  brand.textContent = "Filler";
  const close = document.createElement("button");
  close.className = "close";
  close.type = "button";
  close.textContent = "×";
  close.title = t.close;
  close.setAttribute("aria-label", t.close);
  head.append(brand, close);
  const primary = document.createElement("button");
  primary.className = "primary";
  primary.type = "button";
  const status = document.createElement("div");
  status.className = "status";
  status.setAttribute("role", "status");
  panel.append(head, primary, status);
  const cardLayer = document.createElement("div");
  shadow.append(style, cardLayer, panel);

  const cardButtons = new Map<string, HTMLButtonElement>();
  /** Cards with content: a virtualized placeholder (`li` with only the id) gets no pill — "Add all" still takes its id. */
  const renderedCards = () => findJobCards(document).filter(({ card }) => card.textContent?.trim());
  let cards: { id: string; card: Element }[] = [];
  const scrollParents = new WeakMap<Element, Element | null>();

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

  const send = async (jobs: LinkedInJobLink[]): Promise<MessageOf<"LINKEDIN_JOBS_ADDED"> | null> => {
    try {
      const reply = await sendMessage<MessageOf<"LINKEDIN_JOBS_ADDED">>({ type: "LINKEDIN_ADD_JOBS", jobs });
      reply.ids.forEach((id) => collected.add(id));
      return reply;
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (/context invalidated|receiving end/i.test(message)) {
        stale = true;
        status.textContent = t.stale;
      } else {
        status.textContent = t.failed + message;
      }
      return null;
    }
  };

  const refreshCollected = async () => {
    try {
      const reply = await sendMessage<MessageOf<"LINKEDIN_COLLECTED">>({ type: "GET_LINKEDIN_COLLECTED" });
      collected.clear();
      reply.ids.forEach((id) => collected.add(id));
      placeCardButtons();
    } catch {
      /* extension reloaded — the buttons still show, and a click says to reload */
    }
  };

  primary.addEventListener("click", async () => {
    if (stale) return;
    const jobs = jobsForPage(document, pageHref(), kind);
    if (jobs.length === 0) {
      status.textContent = t.none;
      return;
    }
    primary.disabled = true;
    const reply = await send(jobs);
    primary.disabled = false;
    if (!reply) return;
    status.textContent = kind === "list" ? `${t.result(reply.added, reply.total)} ${t.found(jobs.length)}` : t.result(reply.added, reply.total);
    placeCardButtons();
  });

  close.addEventListener("click", () => {
    dismissedFor = pageHref();
    render();
  });

  cardLayer.addEventListener("click", async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-id]");
    const id = button?.dataset.id;
    if (!button || !id || collected.has(id) || stale) return;
    const entry = cards.find((c) => c.id === id);
    if (!entry) return;
    const job = readCard(entry.card, id);
    const selected = currentJob(document, pageHref());
    const reply = await send([selected?.id === id ? { ...selected, ...nonEmpty(job) } : job]);
    if (reply) status.textContent = t.result(reply.added, reply.total);
    placeCardButtons();
  });

  /** The element whose own scrollbar moves this card (LinkedIn's results column), for clipping. */
  const scrollParentOf = (card: Element): Element | null => {
    if (scrollParents.has(card)) return scrollParents.get(card) ?? null;
    let found: Element | null = null;
    for (let el = card.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const overflow = getComputedStyle(el).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && el.scrollHeight > el.clientHeight) {
        found = el;
        break;
      }
    }
    scrollParents.set(card, found);
    return found;
  };

  let frame = 0;
  const placeCardButtons = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const shown = new Set<string>();
      if (kind && dismissedFor !== pageHref()) {
        const viewport = { top: 0, left: 0, bottom: innerHeight, right: innerWidth };
        const panelRect = panel.getBoundingClientRect();
        for (const { id, card } of cards) {
          if (shown.has(id) || !card.isConnected) continue;
          const rect = card.getBoundingClientRect();
          if (rect.height < 40 || rect.width < 120) continue;
          const clip = scrollParentOf(card)?.getBoundingClientRect() ?? viewport;
          const top = rect.bottom - 30;
          const right = rect.right - 8;
          if (top < Math.max(clip.top, 0) || top + 24 > Math.min(clip.bottom, innerHeight) || right > Math.min(clip.right, innerWidth) || right - 80 < Math.max(clip.left, 0)) continue;
          // Not over the floating panel.
          if (top + 24 > panelRect.top && right > panelRect.left && top < panelRect.bottom) continue;
          let button = cardButtons.get(id);
          if (!button) {
            button = document.createElement("button");
            button.type = "button";
            button.className = "card";
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
          button.style.top = `${Math.round(top)}px`;
          button.style.right = `${Math.round(innerWidth - right)}px`;
          button.style.display = "";
          shown.add(id);
        }
      }
      for (const [id, button] of cardButtons) if (!shown.has(id)) button.style.display = "none";
    });
  };

  const render = () => {
    kind = linkedInPageKind(pageHref());
    if (!kind) {
      host.remove();
      cards = [];
      placeCardButtons();
      return;
    }
    attach();
    panel.style.display = dismissedFor === pageHref() ? "none" : "";
    primary.textContent = kind === "view" ? t.addThis : t.addAll;
    cards = renderedCards();
    placeCardButtons();
  };

  let debounce: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver(() => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      if (kind && !host.isConnected) attach();
      if (kind) {
        cards = renderedCards();
        placeCardButtons();
      }
    }, MUTATION_DEBOUNCE_MS);
  });

  let lastHref = pageHref();
  const onNavigate = () => {
    if (pageHref() === lastHref) return;
    const pathChanged = new URL(lastHref).pathname !== new URL(pageHref()).pathname;
    lastHref = pageHref();
    if (pathChanged) status.textContent = "";
    render();
  };
  const onVisible = () => {
    if (document.visibilityState === "visible" && kind) void refreshCollected();
  };
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  const onScroll = () => placeCardButtons();

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
