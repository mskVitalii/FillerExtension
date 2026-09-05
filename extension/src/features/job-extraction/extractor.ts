import { EMPTY_JOB, type Job } from "@/types/job";
import { extractFromJsonLd } from "./json-ld";
import { extractFromDom } from "./dom-heuristics";
import { extractSiteSpecific } from "./sites";

/** True when DOM/JSON-LD extraction produced enough signal to skip the AI fallback. */
export function isExtractionSufficient(job: Job): boolean {
  return Boolean(job.position) && Boolean(job.company) && job.description.length > 200;
}

const nonEmpty = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);

/** Overlays a site-specific extractor's fields onto the generic pass, ignoring empty/absent ones. */
function applyOverlay(base: Job, o: Partial<Job>): Job {
  return {
    ...base,
    position: nonEmpty(o.position) ?? base.position,
    company: nonEmpty(o.company) ?? base.company,
    location: nonEmpty(o.location) ?? base.location,
    description: nonEmpty(o.description) ?? base.description,
    requirements: o.requirements?.length ? o.requirements : base.requirements,
    responsibilities: o.responsibilities?.length ? o.responsibilities : base.responsibilities,
    salary: o.salary ?? base.salary,
    techStack: o.techStack?.length ? o.techStack : base.techStack,
    contact: o.contact ?? base.contact,
    url: nonEmpty(o.url) ?? base.url,
  };
}

/**
 * Merges three passes, lowest to highest confidence (spec section 10):
 * generic DOM heuristics → a site-specific extractor (`sites/`) when one
 * recognises the page (e.g. Y Combinator's Work at a Startup, whose title
 * and description need bespoke parsing) → schema.org JSON-LD when present.
 */
export function extractJob(doc: Document, url: string): Job {
  let job = extractFromDom(doc, url);

  const site = extractSiteSpecific(doc, url);
  if (site) job = applyOverlay(job, site);

  const ld = extractFromJsonLd(doc);
  if (ld) job = applyOverlay(job, ld);

  return job;
}

export { EMPTY_JOB };
