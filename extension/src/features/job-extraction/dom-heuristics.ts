import type { Job } from "@/types/job";

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

const REQUIREMENTS_RE = /require|qualif|what you.?ll need|must have|anforderungen/i;
const RESPONSIBILITIES_RE = /responsibilit|what you.?ll do|the role|aufgaben/i;
const SALARY_RE = /\$\s?\d[\d,.]*\s?[-–—]\s?\$?\s?\d[\d,.]*|€\s?\d[\d,.]*|salary|gehalt/i;

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
    const pattern = new RegExp(`\\b${tech.replace(/[.+]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) found.add(tech);
  }
  return Array.from(found);
}

/**
 * Generic DOM extraction fallback (spec sections 10-11) — no ATS-specific
 * selectors. Uses semantic HTML, meta tags and heading proximity so it
 * survives across LinkedIn/Greenhouse/Lever/Workday/plain HTML alike.
 */
export function extractFromDom(doc: Document, url: string): Job {
  const root = mainContent(doc);
  const bodyText = root.innerText || root.textContent || "";

  const position = meta(doc, "og:title") || firstHeadingText(root) || doc.title;
  const company = meta(doc, "og:site_name") || "";
  const description = bodyText.replace(/\s+/g, " ").trim().slice(0, 6000);

  const salaryMatch = bodyText.match(SALARY_RE);

  return {
    position,
    company,
    location: "",
    description,
    requirements: listItemsNearHeading(root, REQUIREMENTS_RE),
    responsibilities: listItemsNearHeading(root, RESPONSIBILITIES_RE),
    salary: salaryMatch ? salaryMatch[0] : null,
    techStack: detectTechStack(bodyText),
    contact: null,
    url,
  };
}
