import type { JobSearchResult } from "@/types/job-search";
import { requestStructured, type ReasoningEffort } from "./client";
import { dropStalePostings, MAX_POSTING_AGE_DAYS } from "@/features/job-search/freshness";
import { negativeInstruction } from "@/features/job-search/negative";
import { todayISO } from "@/lib/date-format";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["jobs"],
  properties: {
    jobs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "location", "url", "salary", "snippet", "postedAt"],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          url: { type: "string" },
          salary: { type: "string" },
          snippet: { type: "string" },
          postedAt: { type: "string" },
        },
      },
    },
  },
} as const;

/** The search's place as a hard rule for the parse pass ("Germany"): a posting elsewhere is dropped, not ranked lower. */
export function placeInstruction(where?: string, remoteOnly?: boolean): string {
  const place = (where ?? "").trim().slice(0, 100);
  const remote = remoteOnly ? " The search is for remote jobs: drop postings that are on-site or hybrid only." : "";
  if (!place) return remote.trim();
  return `The search is for jobs in "${place}". Drop every posting whose workplace is outside ${place} — another country, or remote only for people elsewhere ("US only", "LATAM") — and drop it too when the text names no place at all and the employer is clearly based elsewhere. Keep postings in ${place} (any city in it) and remote postings open to people living there. "location" is the posting's own place, as specific as the text gives it ("Munich, Germany", "Remote (Germany)"); never leave it empty when the text names one.${remote}`;
}

function systemPrompt(today: string, negative?: string, place?: string): string {
  const exclusion = negativeInstruction(negative);
  return `You turn raw web-search results about job openings into a clean,
structured list. The input text was produced by a live internet search and may include
citations, markdown links, or unrelated surrounding prose — extract only genuine
individual job postings from it.

Rules:
- Only include entries that are clearly actual job postings with a real listing URL —
  never a company's generic careers-page homepage, a search-results page, or an
  aggregator's category page.
- "url" must be copied exactly from the source text (never invented).
- "salary" is "" when no figure was given — never guess one.
- "postedAt" is the date the posting was published, as YYYY-MM-DD, only when the text
  states it. Resolve relative dates ("posted 3 days ago", "2w") against today, ${today}.
  Use "" when no date is given — never guess one.
- Drop postings the text marks as closed, expired, filled or "no longer accepting
  applications", and postings published more than ${MAX_POSTING_AGE_DAYS} days before ${today}.
- "snippet" is a 1-2 sentence summary of the role; when a "candidate" background is given
  below, make it say *why this posting fits them* specifically (seniority match, matching
  skills, location/remote fit) rather than just restating the posting.
- If a "candidate" background is given, drop postings that are clearly a poor fit for them
  (an unrelated field, a seniority far off). When unsure, keep it: a later step scores the fit.
- Deduplicate: the same posting linked twice becomes one entry.${place ? `\n- ${place}` : ""}${exclusion ? `\n- ${exclusion}` : ""}
- If nothing in the text is actually a job posting, return an empty "jobs" array.`;
}

/**
 * spec_5 section C: shared second pass for both the OpenAI-web-search and
 * Tavily providers — neither returns already-structured job listings, so
 * their raw text/results get parsed into the app's normalized shape here.
 * `candidateBackground` (the applicant's own Personal Legend, spec_8 item
 * 8), when given, lets this pass also rank/filter for fit and write a
 * fit-focused snippet, rather than blindly extracting every posting-shaped
 * thing in the text. `options.negative` (the Search tab's "what I don't
 * want") drops matching postings here too, behind the offline
 * `splitByNegative` pass.
 */
export async function extractJobListings(
  rawText: string,
  source: "openai" | "tavily",
  candidateBackground?: string,
  options: { negative?: string; where?: string; remoteOnly?: boolean; reasoningEffort?: ReasoningEffort; timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<JobSearchResult[]> {
  const userPrompt = candidateBackground
    ? `candidate:\n${candidateBackground}\n\n---\n\n${rawText.slice(0, 40000)}`
    : rawText.slice(0, 40000);

  const result = await requestStructured<{
    jobs: Omit<JobSearchResult, "source">[];
  }>({
    schemaName: "job_listings",
    schema: SCHEMA,
    systemPrompt: systemPrompt(todayISO(), options.negative, placeInstruction(options.where, options.remoteOnly)),
    userPrompt,
    reasoningEffort: options.reasoningEffort,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    label: "Parsing search results",
    parse: (raw) => JSON.parse(raw) as { jobs: Omit<JobSearchResult, "source">[] },
  });
  // The model is told to drop old postings itself; this catches the ones it let through anyway.
  return dropStalePostings(result.jobs.filter((j) => j.url.trim()).map((j) => ({ ...j, source })));
}
