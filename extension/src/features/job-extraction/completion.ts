import type { Job } from "@/types/job";

/**
 * Pure helpers for completing a DOM-insufficient extraction with AI: the DOM result is shown
 * first, and the AI pass only fills what the DOM couldn't find — it never re-types the posting.
 */

/** Below this, the DOM description is a stub and the page's own text stands in for it. */
const MIN_DESCRIPTION = 200;
const MAX_DESCRIPTION = 6000;

/** Fields the AI pass may fill. `description` is never one of them — it always comes from the page. */
export type CompletableField =
  | "position"
  | "company"
  | "location"
  | "requirements"
  | "responsibilities"
  | "techStack"
  | "salary"
  | "contact";

/**
 * Title, company and location are always asked for: they're a few tokens, and the DOM's versions
 * are often noisy (`og:title` = "Engineer at Acme | LinkedIn", `og:site_name` = the job board).
 * Everything else only when the DOM found nothing.
 */
export function fieldsToFill(job: Job): CompletableField[] {
  const fields: CompletableField[] = ["position", "company", "location"];
  if (job.requirements.length === 0) fields.push("requirements");
  if (job.responsibilities.length === 0) fields.push("responsibilities");
  if (job.techStack.length === 0) fields.push("techStack");
  if (!job.salary) fields.push("salary");
  if (!job.contact) fields.push("contact");
  return fields;
}

export type JobCompletion = Pick<Job, CompletableField>;

/** Overlays the AI's answers onto the DOM job, only for `fields`; the description comes from the page. */
export function mergeCompletion(dom: Job, ai: JobCompletion, fields: CompletableField[], pageText: string): Job {
  const fill = new Set(fields);
  const found: JobCompletion = dom;
  const take = <K extends CompletableField>(key: K, empty: (v: JobCompletion[K]) => boolean): JobCompletion[K] =>
    fill.has(key) && !empty(ai[key]) ? ai[key] : found[key];
  const blank = (v: string | null) => !v?.trim();
  const none = (v: string[]) => v.length === 0;

  const pageDescription = pageText.replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
  return {
    ...dom,
    position: take("position", blank).trim(),
    company: take("company", blank).trim(),
    location: take("location", blank).trim(),
    requirements: take("requirements", none),
    responsibilities: take("responsibilities", none),
    techStack: take("techStack", none),
    salary: take("salary", blank),
    contact: take("contact", blank),
    description:
      dom.description.length >= MIN_DESCRIPTION || pageDescription.length <= dom.description.length
        ? dom.description
        : pageDescription,
  };
}

/**
 * Applies a completed job to the one on screen without clobbering what the user typed while the
 * AI pass ran: a field takes the completed value only if it still shows what the DOM found.
 */
export function keepUserEdits(current: Job, dom: Job, completed: Job): Job {
  const result = { ...current };
  for (const key of Object.keys(completed) as (keyof Job)[]) {
    if (JSON.stringify(current[key]) === JSON.stringify(dom[key])) {
      (result as Record<keyof Job, unknown>)[key] = completed[key];
    }
  }
  return result;
}
