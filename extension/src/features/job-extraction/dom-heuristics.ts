import type { Job } from "@/types/job";
import { containsKeyword } from "@/features/keywords/match";

function meta(doc: Document, name: string): string | null {
  const el =
    doc.querySelector(`meta[property="${name}"]`) ?? doc.querySelector(`meta[name="${name}"]`);
  return el?.getAttribute("content")?.trim() || null;
}

function mainContent(doc: Document): HTMLElement {
  return (
    doc.querySelector<HTMLElement>("article") ??
    doc.querySelector<HTMLElement>("main") ??
    doc.querySelector<HTMLElement>('[role="main"]') ??
    doc.body
  );
}

/** Below this, an `article`/`main` is a card or a stub, not the posting — read the whole body instead. */
const MIN_MAIN_TEXT = 500;

/**
 * The page text the AI pass reads: the main content region, so the nav, footer, cookie banner and
 * "similar jobs" rail don't eat the prompt — or the whole body when no region holds the posting.
 */
export function pageMainText(doc: Document): string {
  const root = mainContent(doc);
  const text = root.innerText || root.textContent || "";
  if (root === doc.body || text.trim().length >= MIN_MAIN_TEXT) return text;
  return doc.body.innerText || doc.body.textContent || "";
}

function firstHeadingText(root: HTMLElement): string {
  const heading = root.querySelector("h1") ?? document.querySelector("h1");
  return heading?.textContent?.trim() ?? "";
}

/** Pulls list items following headings whose text matches one of `keywords`. */
function listItemsNearHeading(root: HTMLElement, keywords: RegExp): string[] {
  const headings = root.querySelectorAll("h2, h3, h4, strong, b");
  for (const heading of headings) {
    const text = heading.textContent ?? "";
    if (!keywords.test(text)) continue;
    let node: Element | null = heading.parentElement;
    for (let hops = 0; node && hops < 4; hops++, node = node.nextElementSibling ?? node.parentElement) {
      const list = node.querySelector?.("ul, ol") ?? (node.matches("ul, ol") ? node : null);
      if (list) {
        return Array.from(list.querySelectorAll("li"))
          .map((li) => li.textContent?.trim() ?? "")
          .filter(Boolean);
      }
    }
  }
  return [];
}

const REQUIREMENTS_RE = /require|qualif|what you.?ll need|what you bring|must have|anforderungen/i;
const RESPONSIBILITIES_RE = /responsibilit|what you.?ll do|the role|aufgaben/i;
/**
 * An actual amount ("$120,000 – $150,000", "€65k", "70.000 EUR"), never the bare word: "send your
 * salary expectations" used to come back as the salary "salary".
 */
const SALARY_RE =
  /[$€£]\s?\d[\d,.]*\s?k?(?:\s?[-–—]\s?[$€£]?\s?\d[\d,.]*\s?k?)?|\d[\d,.]*\s?k?\s?(?:€|EUR|USD|GBP)\b/i;

const TECH_KEYWORDS = [
  "JavaScript",
  "TypeScript",
  "React",
  "Vue",
  "Angular",
  "Node.js",
  "Python",
  "Java",
  "Go",
  "Rust",
  "C++",
  "C#",
  "Kotlin",
  "Swift",
  "SQL",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "AWS",
  "GCP",
  "Azure",
  "Docker",
  "Kubernetes",
  "GraphQL",
  "REST",
  "Terraform",
];

function detectTechStack(text: string): string[] {
  const found = new Set<string>();
  for (const tech of TECH_KEYWORDS) {
    if (containsKeyword(text, tech)) found.add(tech);
  }
  return Array.from(found);
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/**
 * A recruiter/hiring contact to reach out to before applying (spec: "Generate
 * outreach message" feature) — looked for as a `mailto:` link or a LinkedIn
 * profile/company URL, which carry far more signal than a bare email address
 * sitting in body text (easy to mistake for e.g. a support address). Falls
 * back to the first visible email-shaped string only when neither link type
 * is present.
 */
function detectContact(root: HTMLElement, bodyText: string): string | null {
  const mailto = root.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
  if (mailto) {
    const address = mailto.href.replace(/^mailto:/i, "").split("?")[0].trim();
    if (address) return address;
  }

  const linkedin = root.querySelector<HTMLAnchorElement>(
    'a[href*="linkedin.com/in/"], a[href*="linkedin.com/company/"]',
  );
  if (linkedin) return linkedin.href;

  const emailMatch = bodyText.match(EMAIL_RE);
  return emailMatch ? emailMatch[0] : null;
}

/**
 * Generic DOM extraction fallback (spec sections 10-11) — no ATS-specific
 * selectors. Uses semantic HTML, meta tags and heading proximity so it
 * survives across LinkedIn/Greenhouse/Lever/Workday/plain HTML alike.
 */
export function extractFromDom(doc: Document, url: string): Job {
  const root = mainContent(doc);
  const bodyText = root.innerText || root.textContent || "";

  const title = meta(doc, "og:title") || doc.title.trim();
  const heading = firstHeadingText(root);
  const { position, location } = positionAndLocation(title, heading);
  const company = companyName(meta(doc, "og:site_name") || "", title, url);
  const description = bodyText.replace(/\s+/g, " ").trim().slice(0, 6000);

  return { position, company, location, description, ...detailsFromElement(root), url };
}

/** "Careers at SumUp", "Jobs bei Acme", "Acme Careers" — the site part of a page title. */
const TITLE_COMPANY_RE = [
  /\b(?:careers?|jobs?|karriere|stellenangebote|stellen)\s+(?:at|bei|@|with)\s+(.+)$/i,
  /^(.+?)\s+(?:careers?|jobs?|karriere|stellenangebote)$/i,
];

/** The company a page title's site tail names, or "". */
function companyFromTitle(title: string): string {
  const parts = title.split(/\s+[|–—·]\s+/);
  if (parts.length < 2) return "";
  const tail = parts[parts.length - 1].trim();
  for (const re of TITLE_COMPANY_RE) {
    const match = tail.match(re);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * `og:site_name` is often the brand plus its tagline ("SumUp - A Better Way to Get Paid"). Keep
 * just the brand: the name the title's "Careers at X" tail gives, else the segment the host
 * spells (sumup.com), else the first segment.
 */
function companyName(siteName: string, title: string, url: string): string {
  const fromTitle = companyFromTitle(title);
  const segments = siteName.split(/\s+[-–—|:·]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return siteName || fromTitle;
  if (fromTitle && squash(siteName).includes(squash(fromTitle))) return fromTitle;
  let host = "";
  try {
    host = squash(new URL(url).hostname);
  } catch {
    /* no host to compare */
  }
  const byHost = host ? segments.find((s) => squash(s).length >= 3 && host.includes(squash(s))) : undefined;
  return byHost ?? segments[0];
}

/**
 * The role and, when the title spells it, the place. A page title is usually the heading plus
 * a tail ("Backend Engineer - Transfers Europe in Berlin, Germany | Careers at SumUp"), so when
 * it starts with the page's `<h1>` the `<h1>` is the role and an "in <place>" right after it is
 * the location. Otherwise the title stays the role, as before.
 */
function positionAndLocation(title: string, heading: string): { position: string; location: string } {
  if (!title) return { position: heading, location: "" };
  const base = title.split(/\s+\|\s+/)[0].trim();
  if (heading && base.toLowerCase().startsWith(heading.toLowerCase())) {
    const rest = base.slice(heading.length).trim();
    const place = rest.match(/^(?:in|[-–—@·,])\s+(.{2,60})$/i)?.[1]?.trim() ?? "";
    return { position: heading, location: /\d/.test(place) ? "" : place };
  }
  return { position: title, location: "" };
}

export type JobDetails = Pick<Job, "requirements" | "responsibilities" | "salary" | "techStack" | "contact">;

/**
 * The list/salary/stack/contact heuristics run on just `root`. A site
 * extractor that knows where the posting's own text is (LinkedIn's "About the
 * job" box) uses this so ads and sidebars around it ("Activate Premium for
 * €0", the company's page link) aren't read as the job's salary or contact.
 */
export function detailsFromElement(root: HTMLElement): JobDetails {
  const text = root.innerText || root.textContent || "";
  const salaryMatch = text.match(SALARY_RE);
  return {
    requirements: listItemsNearHeading(root, REQUIREMENTS_RE),
    responsibilities: listItemsNearHeading(root, RESPONSIBILITIES_RE),
    salary: salaryMatch ? salaryMatch[0] : null,
    techStack: detectTechStack(text),
    contact: detectContact(root, text),
  };
}
