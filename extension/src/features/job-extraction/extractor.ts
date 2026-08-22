import { EMPTY_JOB, type Job } from "@/types/job";
import { extractFromJsonLd } from "./json-ld";
import { extractFromDom } from "./dom-heuristics";

/** True when DOM/JSON-LD extraction produced enough signal to skip the AI fallback. */
export function isExtractionSufficient(job: Job): boolean {
  return Boolean(job.position) && Boolean(job.company) && job.description.length > 200;
}

/**
 * Merges the JSON-LD structured-data pass with the generic DOM heuristics
 * pass (spec section 10). JSON-LD wins per-field when present since it's
 * the highest-confidence source; DOM heuristics fill the rest.
 */
export function extractJob(doc: Document, url: string): Job {
  const domJob = extractFromDom(doc, url);
  const ld = extractFromJsonLd(doc);
  if (!ld) return domJob;

  return {
    ...domJob,
    position: ld.position || domJob.position,
    company: ld.company || domJob.company,
    location: ld.location || domJob.location,
    description: ld.description || domJob.description,
    salary: ld.salary ?? domJob.salary,
  };
}

export { EMPTY_JOB };
