/**
 * Reads LinkedIn job links out of the DOM LinkedIn has already rendered — nothing else. Pure
 * functions over a `Document`/`Element`, so the jsdom suite drives them directly.
 *
 * Extension-only: the on-page collector (`collector.ts`) and the background use this. FillerAgent
 * (the desktop app that drives a browser) must never import anything from `linkedin-collector/`.
 *
 * A job is identified by its numeric id, and stored only as the canonical
 * `https://www.linkedin.com/jobs/view/<id>/` — tracking parameters (`refId`, `trackingId`, `eBP`),
 * country subdomains (`de.linkedin.com`) and slugs (`/jobs/view/senior-engineer-at-acme-123`) are
 * dropped. The card markup LinkedIn ships, newest first:
 *  - server-driven UI: obfuscated classes, a link to `/jobs/view/<id>/` or to the search page with
 *    `?currentJobId=<id>`, inside `[componentkey]` / `li` / `[role="button"]` wrappers;
 *  - the classic list: `li[data-occludable-job-id]` > `div[data-job-id]`, title link
 *    `a.job-card-list__title…`. Off-screen cards stay as empty `li`s with only the id;
 *  - the logged-out list: `div.base-card[data-entity-urn="urn:li:jobPosting:<id>"]`.
 */

export interface LinkedInJobLink {
  /** LinkedIn's numeric job id. */
  id: string;
  /** Always `https://www.linkedin.com/jobs/view/<id>/`. */
  url: string;
  /** "" when the card isn't rendered (virtualized) or its markup wasn't recognised. */
  title: string;
  company: string;
  location: string;
}

const LINKEDIN_HOST_RE = /(^|\.)linkedin\.com$/i;
const ID_RE = /^\d{5,20}$/;

export function canonicalJobUrl(id: string): string {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

/** A job id from any LinkedIn job link: `/jobs/view/<id>`, `/jobs/view/<slug>-<id>`, `?currentJobId=<id>`. */
export function jobIdFromHref(href: string | null | undefined, base = "https://www.linkedin.com/"): string {
  if (!href) return "";
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return "";
  }
  if (!LINKEDIN_HOST_RE.test(url.hostname)) return "";
  const view = url.pathname.match(/^\/(?:comm\/)?jobs\/view\/(?:[^/]*?-)?(\d{5,20})(?:\/|$)/);
  if (view) return view[1];
  const current = url.searchParams.get("currentJobId");
  if (current && ID_RE.test(current) && /^\/jobs\//.test(url.pathname)) return current;
  return "";
}

/** A canonical link for an id or any LinkedIn job URL; "" when it isn't one. */
export function canonicalizeJobLink(value: string): string {
  const id = ID_RE.test(value) ? value : jobIdFromHref(value);
  return id ? canonicalJobUrl(id) : "";
}

const URN_RE = /urn:li:(?:fsd_)?job(?:Posting|PostingCard)?:(\d{5,20})/;
/**
 * A job id in any other attribute: LinkedIn's server-driven UI changes its markup often and may carry
 * the id in a `componentkey`, a tracking or URN attribute rather than a link. Only next to a word
 * that says "job", so a random number (an image size, an ember id) never counts.
 */
const JOB_ATTR_RE = /(?:jobPosting|job[-_]?card|JobCard|currentJobId|jobs\/view\/(?:[^/"?]*-)?|jobId|job[-_]id)\D{0,40}?(\d{6,20})/i;

/** The job id one attribute carries, or "". */
function idFromAttribute(el: Element, name: string, value: string): string {
  if (!value || value.length > 2000) return "";
  if (name === "data-job-id" || name === "data-occludable-job-id") return ID_RE.test(value.trim()) ? value.trim() : "";
  if (name === "href") return el.tagName === "A" ? jobIdFromHref(value) : "";
  if (name === "src" || name === "srcset" || name === "style" || name === "class") return "";
  return value.match(URN_RE)?.[1] ?? value.match(JOB_ATTR_RE)?.[1] ?? "";
}

/**
 * The details pane of the selected job (search pages) and the single posting (`/jobs/view/`):
 * its title link is a `/jobs/view/` link too, but it isn't a card in the list.
 */
export const DETAILS_SELECTOR = [
  "[data-sdui-screen*='JobDetails']",
  ".jobs-search__job-details",
  ".jobs-search__job-details--container",
  ".jobs-details",
  ".job-view-layout",
  ".jobs-unified-top-card",
  ".job-details-jobs-unified-top-card__container--two-pane",
].join(", ");

/** Every element carrying a job id (attribute or link), outside the details pane, in document order. */
function idCarriers(root: ParentNode): { el: Element; id: string }[] {
  const details = [...root.querySelectorAll(DETAILS_SELECTOR)];
  const hits: { el: Element; id: string }[] = [];
  for (const el of root.querySelectorAll("*")) {
    if (details.some((pane) => pane.contains(el))) continue;
    for (const attr of el.attributes) {
      const id = idFromAttribute(el, attr.name, attr.value);
      if (id) {
        hits.push({ el, id });
        break;
      }
    }
  }
  return hits;
}

/**
 * The card around an id carrier: climbs while the ancestor holds no other job, and stops at the
 * first element that is one item of a list (its parent has 3+ children of its tag) — so the list
 * itself, or the whole results column, is never taken for one card, even when only one card in it
 * carries an id.
 */
function cardFor(start: Element, id: string, carriers: { el: Element; id: string }[]): Element {
  let el = start;
  for (let parent = el.parentElement; parent && parent !== start.ownerDocument.body; parent = el.parentElement) {
    if (parent.matches(DETAILS_SELECTOR)) break;
    const alike = [...parent.children].filter((child) => child.tagName === el.tagName).length;
    // A link among 3+ links in one block isn't a list item; any other element is.
    if (alike >= 3 && (el !== start || el.tagName !== "A")) return el;
    if (carriers.some((carrier) => carrier.id !== id && parent!.contains(carrier.el))) return el;
    el = parent;
  }
  return el;
}

/** Card containers for every job on the page that LinkedIn has put in the DOM, in document order. */
export function findJobCards(root: ParentNode): { id: string; card: Element }[] {
  const carriers = idCarriers(root);
  const byCard = new Map<Element, string>();
  for (const { el, id } of carriers) {
    const card = cardFor(el, id, carriers);
    if (!byCard.has(card)) byCard.set(card, id);
  }
  // Nested results (a card inside another's card, which can't be two jobs): keep the outermost.
  const cards = [...byCard.entries()].filter(([card]) => ![...byCard.keys()].some((other) => other !== card && other.contains(card)));
  return cards
    .map(([card, id]) => ({ id, card }))
    .sort((a, b) => (a.card.compareDocumentPosition(b.card) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

const JOB_LINK_SELECTOR = "a[href*='/jobs/view/'], a[href*='currentJobId=']";

/** "Easy Apply" — LinkedIn's own application form. Filler never applies on LinkedIn, so these are skipped. */
export const EASY_APPLY_RE = /easy apply|einfach bewerben|candidature simplifiée|solicitud sencilla|candidatura semplificata|простой отклик/i;

export function isEasyApplyCard(card: Element): boolean {
  return EASY_APPLY_RE.test(card.textContent ?? "") || EASY_APPLY_RE.test(card.getAttribute("aria-label") ?? "");
}

/** A virtualized placeholder: LinkedIn keeps only the id of a card far off screen. */
export function isRenderedCard(card: Element): boolean {
  return Boolean(card.textContent?.trim());
}

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Badges and status lines a card shows next to the job's own facts. */
const NOISE_RE =
  /^(?:promoted|gefördert|beworben|applied|viewed|angesehen|saved|gespeichert|easy apply|einfach bewerben|actively (?:reviewing|recruiting)(?: applicants)?|be an early applicant|new|neu|reposted.*|.*\b\d+\+?\s+(?:applicants?|bewerber\w*|bewerbungen|connections?|kontakte?|alumni|school alumni|benefits?)\b.*|.*\bago\b|vor \d+.*|.*(?:€|\$|£)\s?\d.*|\d.*(?:€|\$|£).*|dismiss.*|[^\p{L}\p{N}]*)$/iu;

/** Visible text lines of a card, in order, without the screen-reader duplicates and badges. */
function cardLines(card: Element): string[] {
  const lines: string[] = [];
  const walker = card.ownerDocument.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest(".visually-hidden, .sr-only, .a11y-text, script, style, button, svg")) continue;
    const text = clean(node.textContent);
    if (!text || text === "·" || NOISE_RE.test(text)) continue;
    if (lines[lines.length - 1] === text) continue;
    lines.push(text);
  }
  return lines;
}

function firstText(card: Element, selectors: string): string {
  for (const el of card.querySelectorAll(selectors)) {
    const text = clean(el.querySelector("strong")?.textContent) || clean(el.getAttribute("aria-label")) || clean(el.textContent);
    if (text && !NOISE_RE.test(text)) return text;
  }
  return "";
}

const TITLE_SELECTORS = ".job-card-list__title--link, .job-card-list__title, .job-card-container__link, .base-search-card__title, .artdeco-entity-lockup__title, h3";
const COMPANY_SELECTORS = ".artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name, .base-search-card__subtitle, h4";
const LOCATION_SELECTORS = ".job-card-container__metadata-item, .job-card-container__metadata-wrapper li, .artdeco-entity-lockup__caption, .job-search-card__location";

/** Title, company and location of one card: the classic class hooks first, else its text lines in order. */
export function readCard(card: Element, id: string): LinkedInJobLink {
  const lines = cardLines(card);
  const titleLink = [...card.querySelectorAll(JOB_LINK_SELECTOR)].find((a) => jobIdFromHref(a.getAttribute("href")) === id);
  let title = firstText(card, TITLE_SELECTORS);
  if (!title && titleLink) title = clean(titleLink.querySelector("strong")?.textContent) || cardLines(titleLink)[0] || "";
  title ||= lines[0] ?? "";
  // "Senior Engineer with verification" — LinkedIn's a11y suffix on the title link.
  title = title.replace(/\s+with verification$/i, "");

  const rest = lines.filter((line) => line !== title && !line.startsWith(title));
  const company = firstText(card, COMPANY_SELECTORS) || rest[0] || "";
  const location = firstText(card, LOCATION_SELECTORS) || rest.find((line) => line !== company) || "";
  return { id, url: canonicalJobUrl(id), title, company, location };
}

/** Keeps the first entry per id, filling its empty fields from later ones (an occluded card first, the rendered one later). */
export function dedupeJobLinks(links: LinkedInJobLink[]): LinkedInJobLink[] {
  const byId = new Map<string, LinkedInJobLink>();
  for (const link of links) {
    const existing = byId.get(link.id);
    if (!existing) {
      byId.set(link.id, { ...link });
      continue;
    }
    existing.title ||= link.title;
    existing.company ||= link.company;
    existing.location ||= link.location;
  }
  return [...byId.values()];
}

/** Every job on the page LinkedIn has put in the DOM, deduped by id (Easy Apply and not-yet-rendered ones included). */
export function collectJobLinks(root: ParentNode): LinkedInJobLink[] {
  return dedupeJobLinks(findJobCards(root).map(({ id, card }) => readCard(card, id)));
}

export interface PageScan {
  /** What "Add all" adds: rendered cards that apply off LinkedIn. */
  jobs: LinkedInJobLink[];
  /** Skipped: Easy Apply cards (LinkedIn's own form — Filler never applies there). */
  easyApply: number;
  /** Skipped: cards LinkedIn hasn't rendered yet (virtualized) — scroll to load them. */
  notLoaded: number;
}

export function scanJobCards(root: ParentNode): PageScan {
  // One job can show up as several cards (a "Recommended" strip, a placeholder and its rendered
  // twin): it's Easy Apply when any of them says so, and loaded when any of them is rendered.
  const byId = new Map<string, Element[]>();
  for (const { id, card } of findJobCards(root)) byId.set(id, [...(byId.get(id) ?? []), card]);
  const scan: PageScan = { jobs: [], easyApply: 0, notLoaded: 0 };
  for (const [id, cards] of byId) {
    const rendered = cards.filter(isRenderedCard);
    if (rendered.length === 0) scan.notLoaded++;
    else if (rendered.some(isEasyApplyCard)) scan.easyApply++;
    else scan.jobs.push(dedupeJobLinks(rendered.map((card) => readCard(card, id)))[0]);
  }
  return scan;
}

export type LinkedInPageKind = "list" | "view" | null;

/** Which collector page this is: a list of jobs (search, collections) or a single posting. */
export function linkedInPageKind(href: string): LinkedInPageKind {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !LINKEDIN_HOST_RE.test(url.hostname)) return null;
  if (/^\/jobs\/(?:search|search-results|collections)(?:\/|$)/.test(url.pathname)) return "list";
  if (/^\/jobs\/view\/(?:[^/]*?-)?\d{5,20}(?:\/|$)/.test(url.pathname)) return "view";
  return null;
}
