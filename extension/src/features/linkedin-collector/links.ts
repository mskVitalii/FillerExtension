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

/** The id the card element itself carries, without looking at its links. */
function ownId(el: Element): string {
  for (const attr of ["data-job-id", "data-occludable-job-id"]) {
    const value = el.getAttribute(attr)?.trim();
    if (value && ID_RE.test(value)) return value;
  }
  const urn = el.getAttribute("data-entity-urn") ?? el.getAttribute("data-urn") ?? "";
  return urn.match(URN_RE)?.[1] ?? "";
}

const ID_ATTR_SELECTOR = "[data-job-id], [data-occludable-job-id], [data-entity-urn*='obPosting:'], [data-urn*='obPosting:']";
const JOB_LINK_SELECTOR = "a[href*='/jobs/view/'], a[href*='currentJobId=']";

/**
 * The details pane of the selected job (search pages) and the single posting (`/jobs/view/`):
 * its title link is a `/jobs/view/` link too, but it isn't a card in the list.
 */
const DETAILS_SELECTOR = [
  "[data-sdui-screen*='JobDetails']",
  ".jobs-search__job-details",
  ".jobs-search__job-details--container",
  ".jobs-details",
  ".job-view-layout",
  ".jobs-unified-top-card",
  ".job-details-jobs-unified-top-card__container--two-pane",
].join(", ");

/** Card wrappers, most specific first, for a job link without an id-carrying ancestor. */
const CARD_WRAPPERS = "li, [componentkey], [data-view-name*='job-card'], [role='listitem'], [role='button'], article";

/** Card containers for every job on the page that LinkedIn has put in the DOM, in document order. */
export function findJobCards(root: ParentNode): { id: string; card: Element }[] {
  const seen = new Set<Element>();
  const found: { id: string; card: Element }[] = [];
  const add = (id: string, card: Element) => {
    if (!id || seen.has(card) || card.closest(DETAILS_SELECTOR)) return;
    // Nested id carriers (`li[data-occludable-job-id] > div[data-job-id]`): keep the outermost.
    for (const other of seen) if (other.contains(card)) return;
    for (const inner of [...seen]) {
      if (card.contains(inner)) {
        seen.delete(inner);
        const index = found.findIndex((entry) => entry.card === inner);
        if (index >= 0) found.splice(index, 1);
      }
    }
    seen.add(card);
    found.push({ id, card });
  };

  for (const el of root.querySelectorAll(ID_ATTR_SELECTOR)) add(ownId(el), el);
  for (const link of root.querySelectorAll(JOB_LINK_SELECTOR)) {
    if (link.closest(ID_ATTR_SELECTOR) || link.closest(DETAILS_SELECTOR)) continue;
    const id = jobIdFromHref(link.getAttribute("href"));
    if (!id) continue;
    add(id, cardFor(link));
  }
  return found.sort((a, b) => (a.card.compareDocumentPosition(b.card) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
}

/**
 * The card around a bare job link: the nearest wrapper that holds this link's job and no other
 * job, so a list `ul` (or the whole results column) is never mistaken for one card.
 */
function cardFor(link: Element): Element {
  const id = jobIdFromHref(link.getAttribute("href"));
  let best: Element = link;
  for (let el = link.parentElement; el && el !== link.ownerDocument.body; el = el.parentElement) {
    const ids = new Set([...el.querySelectorAll(JOB_LINK_SELECTOR)].map((a) => jobIdFromHref(a.getAttribute("href"))).filter(Boolean));
    if (ids.size > 1 || (ids.size === 1 && !ids.has(id))) break;
    if (el.matches(CARD_WRAPPERS)) best = el;
  }
  return best;
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

/** Every job on the page LinkedIn has put in the DOM, deduped by id. */
export function collectJobLinks(root: ParentNode): LinkedInJobLink[] {
  return dedupeJobLinks(findJobCards(root).map(({ id, card }) => readCard(card, id)));
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
