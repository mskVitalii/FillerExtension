import type { Job } from "@/types/job";
import type { CvVariable } from "@/types/cv-template";

/**
 * Placeholders the extension knows out of the box. The user types them into
 * their own CV; when one shows up, it starts with this definition (what the
 * AI is told to put there) instead of a blank one — nothing to set up for the
 * common cases. Variables are never created from the CV by the extension:
 * only placeholders actually in the file exist.
 *
 * `fromJob` fills the placeholder straight from the posting, offline, before
 * (or without) the AI pass.
 */
interface KnownVariable {
  names: string[];
  description: string;
  mode: CvVariable["mode"];
  fromJob?: (job: Job) => string;
}

/** "Munich, Bavaria, Germany (Hybrid)" → parts without work-mode noise. */
function locationParts(location: string): string[] {
  return location
    .replace(/\([^)]*\)/g, " ")
    .split(/[,/|·•]/)
    .map((part) => part.replace(/\b(remote|hybrid|on-?site|onsite|home ?office)\b/gi, "").trim())
    .filter(Boolean);
}

/** A title without the "(m/w/d)"-style gender marker German postings append. */
function cleanTitle(position: string): string {
  return position
    .replace(/\s*\((?:[mwfdx]\s*\/\s*)+[mwfdx]\)\s*/gi, " ")
    .replace(/\s*[-–|]\s*(?:[mwfdx]\/)+[mwfdx]\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const KNOWN_VARIABLES: KnownVariable[] = [
  {
    names: ["city", "town"],
    description: "The city of the job, from the posting's location. For a fully remote job, keep the applicant's own city.",
    mode: "free",
    fromJob: (job) => locationParts(job.location)[0] ?? "",
  },
  {
    names: ["country"],
    description: "The country of the job, from the posting's location.",
    mode: "free",
    fromJob: (job) => {
      const parts = locationParts(job.location);
      return parts.length > 1 ? parts[parts.length - 1] : "";
    },
  },
  {
    names: ["location"],
    description: "The job's location as the posting gives it: city, country.",
    mode: "free",
    fromJob: (job) => locationParts(job.location).join(", "),
  },
  {
    names: ["job_position", "position", "job_title", "title", "role"],
    description: "The job title exactly as the posting names it, without gender markers like (m/w/d).",
    mode: "free",
    fromJob: (job) => cleanTitle(job.position),
  },
  {
    names: ["company", "company_name", "employer"],
    description: "The hiring company's name.",
    mode: "free",
    fromJob: (job) => job.company.trim(),
  },
  {
    names: ["main_language", "language", "main_stack"],
    description: "The one programming language this job centers on. Add the languages you work with as variants.",
    mode: "choice",
  },
  {
    names: ["keywords", "skills", "tech_stack", "stack"],
    description:
      "4 to 8 comma-separated technologies and skills the posting asks for that the applicant's CV or Personal Legend actually backs up, most important first.",
    mode: "free",
  },
  {
    names: ["headline", "summary_title"],
    description: "A short professional headline aimed at this role, in the CV's language, max ~8 words.",
    mode: "free",
  },
];

function known(name: string): KnownVariable | undefined {
  const key = name.toLowerCase();
  return KNOWN_VARIABLES.find((variable) => variable.names.includes(key));
}

/** The definition a newly found placeholder starts with: the known one, else blank. */
export function initialVariable(name: string): CvVariable {
  const match = known(name);
  return { name, description: match?.description ?? "", options: [], mode: match?.mode ?? "choice" };
}

/** A value read straight off the posting for a known placeholder (city, job title, company…), or "". */
export function valueFromJob(name: string, job: Job): string {
  return known(name)?.fromJob?.(job) ?? "";
}
