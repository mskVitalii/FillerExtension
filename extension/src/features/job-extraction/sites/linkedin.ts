import type { Job } from "@/types/job";
import { detailsFromElement } from "../dom-heuristics";

/**
 * LinkedIn jobs: the search results (`/jobs/search-results/`, `/jobs/search/`,
 * `/jobs/collections/`) and a single posting (`/jobs/view/<id>/`).
 *
 * The search page holds dozens of cards plus a details pane for the selected
 * job. The generic pass picks up the wrong things there: card titles, the
 * header search box, recommendation blurbs. The page also has no JSON-LD. The details
 * pane is a server-driven UI screen with obfuscated class names, so this reads
 * only the stable hooks LinkedIn ships:
 *  - the pane: `[data-sdui-screen*="JobDetails"]` (e.g. `…jobs.SemanticJobDetails`);
 *  - title: the pane's first `a[href*="/jobs/view/"]`, whose id is also the job's id;
 *  - company: `[aria-label="Company, <name>."]`, or a `/company/` link with text;
 *  - location: the first `<span>` of the line after the title,
 *    "Munich, Bavaria, Germany · 2 weeks ago · Over 100 applicants";
 *  - work mode: a "Hybrid"/"Remote"/"On-site" chip, appended to the location;
 *  - description: `[componentkey^="JobDetails_AboutTheJob_"] [data-testid="expandable-text-box"]`,
 *    without its "… more" toggle (the full text is in the DOM even while collapsed).
 *    Requirements, salary, stack and contact are read from that box only:
 *    the pane around it has "Activate Premium for €0" and the company's page link.
 * `<title>` is "Role | Company | LinkedIn" and fills anything the pane lacks.
 */

const JOB_PATH_RE = /^\/jobs\/(?:search-results|search|view|collections)(?:\/|$)/;

export function isLinkedInJobsPage(url: string): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return /(^|\.)linkedin\.com$/i.test(hostname) && JOB_PATH_RE.test(pathname);
  } catch {
    return false;
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "BR", "SECTION"]);

/** Readable text of the description: one line per block, "• " for list items, no "… more" button. */
function blockText(root: Element): string {
  const lines: string[] = [];
  let current = "";
  const flush = () => {
    const line = current.replace(/[ \t\u00a0]+/g, " ").trim();
    if (line) lines.push(line);
    current = "";
  };
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      current += node.textContent ?? "";
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches('button, [data-testid="expandable-text-button"], script, style')) return;
    const block = BLOCK_TAGS.has(node.tagName);
    if (block) flush();
    if (node.tagName === "LI") current += "• ";
    node.childNodes.forEach(walk);
    if (block) flush();
  };
  walk(root);
  flush();
  return lines.join("\n").slice(0, 8000);
}

function jobIdFrom(url: string, titleHref: string | null): string {
  try {
    const parsed = new URL(url);
    const current = parsed.searchParams.get("currentJobId");
    if (current && /^\d+$/.test(current)) return current;
    const view = parsed.pathname.match(/\/jobs\/view\/(\d+)/);
    if (view) return view[1];
  } catch {
    /* fall through to the title link */
  }
  return titleHref?.match(/\/jobs\/view\/(\d+)/)?.[1] ?? "";
}

function companyFrom(root: Element): string {
  for (const el of root.querySelectorAll("[aria-label]")) {
    const match = el.getAttribute("aria-label")?.match(/^Company,\s*(.+?)\.?\s*$/);
    if (match) return clean(match[1]);
  }
  for (const link of root.querySelectorAll('a[href*="/company/"]')) {
    const text = clean(link.textContent);
    if (text) return text;
  }
  return "";
}

const WORK_MODE_RE = /^(Hybrid|Remote|On-site)$/i;

function locationFrom(root: Element, titleLink: Element): string {
  const titleBlock = titleLink.closest("p, h1, h2, h3") ?? titleLink;
  // The title sits a few wrappers deep; the meta line is the next <p> in document order.
  const paragraphs = [...root.querySelectorAll("p")];
  const meta = paragraphs.find(
    (p) => titleBlock.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING && !titleBlock.contains(p),
  );
  let location = "";
  if (meta) {
    const firstSpan = clean(meta.querySelector("span")?.textContent);
    location = firstSpan || clean(meta.textContent).split(" · ")[0] || "";
    if (/\b(?:ago|applicants?|reposted)\b/i.test(location)) location = "";
  }

  const mode = [...root.querySelectorAll("button, span, a, li")]
    .map((el) => clean(el.textContent))
    .find((text) => WORK_MODE_RE.test(text));
  if (mode && !location.toLowerCase().includes(mode.toLowerCase())) {
    location = location ? `${location} (${mode})` : mode;
  }
  return location;
}

/** "Founding AI Engineer (Renewable Energy) | ELANI One | LinkedIn" → role + company. */
function fromDocumentTitle(doc: Document): { position: string; company: string } {
  const parts = doc.title.split(" | ").map(clean);
  if (parts.length >= 3 && /^LinkedIn$/i.test(parts[parts.length - 1])) {
    return { position: parts[0], company: parts[1] };
  }
  return { position: "", company: "" };
}

/** Returns only the fields it can fill with confidence; `null` when the page isn't a LinkedIn jobs page. */
export function extractLinkedIn(doc: Document, url: string): Partial<Job> | null {
  if (!isLinkedInJobsPage(url)) return null;

  const root = doc.querySelector('[data-sdui-screen*="JobDetails"]');
  const result: Partial<Job> = {};

  // Title, company and location only from the pane: outside it, the first /jobs/view/ link is a result card.
  const titleLink = root?.querySelector('a[href*="/jobs/view/"]') ?? null;
  if (root) {
    const position = clean(titleLink?.textContent);
    if (position) result.position = position;

    const company = companyFrom(root);
    if (company) result.company = company;

    if (titleLink) {
      const location = locationFrom(root, titleLink);
      if (location) result.location = location;
    }
  }

  const box = (root ?? doc).querySelector(
    '[componentkey^="JobDetails_AboutTheJob_"] [data-testid="expandable-text-box"]',
  );
  if (box instanceof HTMLElement) {
    const description = blockText(box);
    if (description) {
      result.description = description;
      // Lists, salary, stack and contact from the posting alone, not the pane's ads and links.
      Object.assign(result, detailsFromElement(box));
    }
  }

  if (root || box) {
    const id = jobIdFrom(url, titleLink?.getAttribute("href") ?? null);
    if (id) result.url = `https://www.linkedin.com/jobs/view/${id}/`;
  }

  // The <title> follows the selected job on LinkedIn — a fallback when the pane's markup changed.
  const fallback = fromDocumentTitle(doc);
  if (!result.position && fallback.position) result.position = fallback.position;
  if (!result.company && fallback.company) result.company = fallback.company;

  return Object.keys(result).length > 0 ? result : null;
}
