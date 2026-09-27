import type { JobSearchResult } from "@/types/job-search";

/**
 * A posting older than this is dropped from search results. Search indexes
 * lag behind reality, so older links increasingly 404 or show "no longer
 * accepting applications" — a month keeps enough results while cutting most
 * of the dead ones.
 */
export const MAX_POSTING_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Applicant tracking systems host the employer's own copy of a posting, and
 * take it down (with a real 404) when it closes — unlike aggregator copies,
 * which linger. Search providers are told to prefer these.
 */
export const ATS_DOMAINS = [
  "boards.greenhouse.io",
  "job-boards.greenhouse.io",
  "jobs.lever.co",
  "jobs.ashbyhq.com",
  "apply.workable.com",
  "jobs.smartrecruiters.com",
  "myworkdayjobs.com",
  "recruitee.com",
  "personio.de",
  "teamtailor.com",
];

/** Days since `postedAt`, or null when it's missing, unparseable, or in the future. */
export function postingAgeDays(postedAt: string | undefined, now = new Date()): number | null {
  if (!postedAt) return null;
  const time = Date.parse(postedAt);
  if (Number.isNaN(time)) return null;
  const days = Math.floor((now.getTime() - time) / DAY_MS);
  return days < 0 ? null : days;
}

/**
 * Drops postings known to be older than `MAX_POSTING_AGE_DAYS`. A posting
 * without a usable date is kept — many real postings don't state one, and
 * dropping them all would empty most searches.
 */
export function dropStalePostings(results: JobSearchResult[], now = new Date()): JobSearchResult[] {
  return results.filter((r) => {
    const age = postingAgeDays(r.postedAt, now);
    return age === null || age <= MAX_POSTING_AGE_DAYS;
  });
}

/** "Posted today" / "Posted 3 days ago" / "Posted 2 weeks ago", or "" when the date is unknown. */
export function formatPostedAgo(postedAt: string | undefined, now = new Date()): string {
  const age = postingAgeDays(postedAt, now);
  if (age === null) return "";
  if (age === 0) return "Posted today";
  if (age === 1) return "Posted yesterday";
  if (age < 14) return `Posted ${age} days ago`;
  if (age < 60) return `Posted ${Math.floor(age / 7)} weeks ago`;
  return `Posted ${Math.floor(age / 30)} months ago`;
}
