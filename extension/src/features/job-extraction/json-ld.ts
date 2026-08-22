import type { Job } from "@/types/job";

interface JobPostingLd {
  "@type"?: string | string[];
  title?: string;
  description?: string;
  hiringOrganization?: { name?: string } | string;
  jobLocation?:
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }
    | { address?: { addressLocality?: string; addressRegion?: string; addressCountry?: string } }[];
  baseSalary?: { value?: { minValue?: number; maxValue?: number; value?: number }; currency?: string };
  employmentType?: string;
}

function isJobPosting(node: JobPostingLd): boolean {
  const type = node["@type"];
  if (!type) return false;
  return Array.isArray(type) ? type.includes("JobPosting") : type === "JobPosting";
}

function locationToString(loc: JobPostingLd["jobLocation"]): string {
  const entry = Array.isArray(loc) ? loc[0] : loc;
  const address = entry?.address;
  if (!address) return "";
  return [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(", ");
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Reads schema.org JobPosting structured data — the highest-confidence source (spec section 10). */
export function extractFromJsonLd(doc: Document): Partial<Job> | null {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];
    for (const node of nodes as JobPostingLd[]) {
      if (!node || typeof node !== "object" || !isJobPosting(node)) continue;
      const org = node.hiringOrganization;
      const company = typeof org === "string" ? org : (org?.name ?? "");
      const salary = node.baseSalary?.value
        ? [node.baseSalary.value.minValue, node.baseSalary.value.maxValue, node.baseSalary.value.value]
            .filter((v): v is number => typeof v === "number")
            .join("–")
        : null;
      return {
        position: node.title ?? "",
        company,
        location: locationToString(node.jobLocation),
        description: node.description ? stripHtml(node.description) : "",
        salary: salary ? `${salary} ${node.baseSalary?.currency ?? ""}`.trim() : null,
      };
    }
  }
  return null;
}
