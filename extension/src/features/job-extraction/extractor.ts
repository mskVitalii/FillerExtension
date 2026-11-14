import { EMPTY_JOB, type Job } from "@/types/job";
import { extractFromJsonLd } from "./json-ld";
import { extractFromDom } from "./dom-heuristics";
import { extractSiteSpecific } from "./sites";
import { cleanJobTitle } from "./clean-title";

/** True when DOM/JSON-LD extraction produced enough signal to skip the AI fallback. */
export function isExtractionSufficient(job: Job): boolean {
  return Boolean(job.position) && Boolean(job.company) && job.description.length > 200;
}

const nonEmpty = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);

/**
 * Overlays a pass's fields onto the job so far, ignoring empty/absent ones.
 * `salary`/`contact` are nullable: a `null` from JSON-LD means "not stated
 * there" and keeps the DOM's guess, while a site extractor that sets the key
 * at all (`trustNulls`) read the posting's own text and found none, so its
 * `null` replaces a guess the generic pass took from ads around it.
 */
function applyOverlay(base: Job, o: Partial<Job>, trustNulls = false): Job {
  const nullable = <K extends "salary" | "contact">(key: K): Job[K] =>
    trustNulls && key in o ? (o[key] ?? null) : (o[key] ?? base[key]);
  return {
    ...base,
    position: nonEmpty(o.position) ?? base.position,
    company: nonEmpty(o.company) ?? base.company,
    location: nonEmpty(o.location) ?? base.location,
    description: nonEmpty(o.description) ?? base.description,
    requirements: o.requirements?.length ? o.requirements : base.requirements,
    responsibilities: o.responsibilities?.length ? o.responsibilities : base.responsibilities,
    salary: nullable("salary"),
    techStack: o.techStack?.length ? o.techStack : base.techStack,
    contact: nullable("contact"),
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
  if (site) job = applyOverlay(job, site, true);

  const ld = extractFromJsonLd(doc);
  if (ld) job = applyOverlay(job, ld);

  return job.position ? { ...job, position: cleanJobTitle(job.position) } : job;
}

export { EMPTY_JOB };
