import type { Job } from "@/types/job";

/**
 * Y Combinator's "Work at a Startup" (workatastartup.com).
 *
 * Why it needs its own pass instead of the generic DOM/JSON-LD one:
 *  - no `schema.org/JobPosting` structured data on the page at all;
 *  - `og:title` is `"{role} at {company} | Y Combinator's Work at a Startup"`,
 *    so the generic pass drops the whole string into `position` and puts
 *    `"Y Combinator's Work at a Startup"` (the `og:site_name`) into `company`;
 *  - `og:site_name` is the marketplace, never the hiring company;
 *  - the real, clean job description is Markdown sitting in
 *    `<meta property="description">` / `og:description`, while the rendered
 *    DOM body is almost entirely YC navigation chrome.
 *
 * So: role/company come from splitting the title on the last " at ", the
 * description + its "What you'll do" / "We're looking for" bullet lists are
 * parsed straight out of the Markdown meta tag, and only the location is
 * scraped from the DOM header (it isn't in any meta tag).
 */

function metaContent(doc: Document, key: string): string {
  const el = doc.querySelector(`meta[property="${key}"]`) ?? doc.querySelector(`meta[name="${key}"]`);
  return el?.getAttribute("content")?.trim() ?? "";
}

/** `" | Y Combinator's Work at a Startup"` (or an en/em-dash variant) tacked onto `<title>`/`og:title`. */
const SITE_SUFFIX_RE = /\s*[|–—-]\s*Y Combinator['’]s Work at a Startup\s*$/i;

export function isWorkAtAStartup(doc: Document, url: string): boolean {
  try {
    if (new URL(url).hostname.replace(/^www\./, "") === "workatastartup.com") return true;
  } catch {
    /* not a parseable URL — fall back to page signals */
  }
  const ogUrl = metaContent(doc, "og:url");
  if (ogUrl && /(^|\/\/|\.)workatastartup\.com\b/i.test(ogUrl)) return true;
  return /^Y Combinator['’]s Work at a Startup$/i.test(metaContent(doc, "og:site_name"));
}

/** "Software engineer, Fullstack at Aviator" → role + company (split on the *last* " at "). */
function splitRoleAndCompany(raw: string): { position: string; company: string } {
  const cleaned = raw.replace(SITE_SUFFIX_RE, "").trim();
  const at = cleaned.toLowerCase().lastIndexOf(" at ");
  if (at === -1) return { position: cleaned, company: "" };
  return { position: cleaned.slice(0, at).trim(), company: cleaned.slice(at + 4).trim() };
}

function companyFromDom(doc: Document): string {
  const link = doc.querySelector('a[href*="/companies/"]');
  return link?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

const LOCATION_RE =
  /\b(?:Remote|Hybrid|On-?site)\b|[A-Z][A-Za-z.'’-]+(?:\s[A-Z][A-Za-z.'’-]+)*,\s*[A-Z]{2}(?:,\s*[A-Za-z]{2,3})?/;

/** WaaS puts the location in a small header row next to a Font Awesome map pin — never in a meta tag. */
function locationFromDom(doc: Document): string {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const plausible = (text: string) =>
    text.length > 0 && text.length <= 60 && !/[.!?]\s/.test(text) && text.split(" ").length <= 8;

  const pin = doc.querySelector(
    ".fa-map-marker, .fa-map-marker-alt, .fa-location-dot, .fa-map-pin, .fa-location-arrow",
  );
  const pinText = clean(pin?.closest("div, span, li, p")?.textContent);
  if (plausible(pinText) && LOCATION_RE.test(pinText)) return pinText;

  for (const el of doc.querySelectorAll('[class*="location" i], [class*="Location"]')) {
    const text = clean(el.textContent);
    if (plausible(text) && LOCATION_RE.test(text)) return text;
  }

  for (const el of doc.querySelectorAll("main *, article *, header *")) {
    if (el.children.length > 0) continue; // leaf nodes only
    const text = clean(el.textContent);
    if (plausible(text) && LOCATION_RE.test(text)) return text;
  }
  return "";
}

const RESPONSIBILITIES_HEADING_RE = /what you.?(?:ll|will)\s+do|responsibilit|your role|the role|day.to.day/i;
const REQUIREMENTS_HEADING_RE =
  /looking for|you (?:have|bring)|you.?ll need|requirement|qualif|must have|ideal candidate|who has|about you/i;

/** Inline Markdown → plain text: drop `**bold**` / `*em*` / `` `code` ``, unwrap `[text](url)`. */
function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bullet lines under the first Markdown heading matching `headingRe`, until the next heading. */
function sectionBullets(markdown: string, headingRe: RegExp): string[] {
  const out: string[] = [];
  let inSection = false;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*\S)\s*$/);
    if (heading) {
      inSection = headingRe.test(heading[1]);
      continue;
    }
    if (!inSection) continue;
    const bullet = line.match(/^\s*[*+-]\s+(.*\S)\s*$/);
    if (bullet) out.push(stripInlineMarkdown(bullet[1]));
  }
  return out;
}

/** Keep the Markdown readable but flatten the syntax an LLM doesn't need. */
function markdownToReadable(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^\s*[*+-]\s+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 6000);
}

/** Returns only the fields it can fill with confidence; `null` when the page isn't a WaaS posting. */
export function extractWorkAtAStartup(doc: Document, url: string): Partial<Job> | null {
  if (!isWorkAtAStartup(doc, url)) return null;

  const { position, company } = splitRoleAndCompany(
    metaContent(doc, "title") || metaContent(doc, "og:title") || doc.title || "",
  );
  const markdown =
    metaContent(doc, "description") ||
    metaContent(doc, "og:description") ||
    metaContent(doc, "twitter:description") ||
    "";

  const result: Partial<Job> = {};
  if (position) result.position = position;

  const companyName = company || companyFromDom(doc);
  if (companyName) result.company = companyName;

  if (markdown) {
    result.description = markdownToReadable(markdown);
    const responsibilities = sectionBullets(markdown, RESPONSIBILITIES_HEADING_RE);
    const requirements = sectionBullets(markdown, REQUIREMENTS_HEADING_RE);
    if (responsibilities.length > 0) result.responsibilities = responsibilities;
    if (requirements.length > 0) result.requirements = requirements;
  }

  const location = locationFromDom(doc);
  if (location) result.location = location;

  return Object.keys(result).length > 0 ? result : null;
}
