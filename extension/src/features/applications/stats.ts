import { todayISO } from "@/lib/date-format";
import type { UrlActivation } from "@/types/application";

export interface SubmissionStats {
  total: number;
  /** Average unique submissions per calendar day, from the first logged day through today. */
  avgPerDay: number;
  /** Counts grouped by day, ascending — one bar per day that had at least one submission. */
  byDay: { date: string; count: number }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days between two `YYYY-MM-DD` dates, inclusive of both ends. */
function daySpan(first: string, last: string): number {
  const start = new Date(`${first}T00:00:00`).getTime();
  const end = new Date(`${last}T00:00:00`).getTime();
  return Math.round((end - start) / DAY_MS) + 1;
}

/**
 * Pure — used by both the sidepanel display and its tests without touching
 * chrome.storage. Deduplicates by URL first (keeping each URL's earliest
 * date) rather than trusting `activations` is already one-entry-per-URL —
 * `recordUrlActivation` enforces that going forward, but a log written
 * before that dedup existed could still have leftover duplicates, and this
 * keeps the chart/total correct either way.
 */
export function computeSubmissionStats(activations: UrlActivation[]): SubmissionStats {
  if (activations.length === 0) return { total: 0, avgPerDay: 0, byDay: [] };

  const dateByUrl = new Map<string, string>();
  for (const { url, date } of activations) {
    const earliest = dateByUrl.get(url);
    if (!earliest || date < earliest) dateByUrl.set(url, date);
  }

  const counts = new Map<string, number>();
  for (const date of dateByUrl.values()) counts.set(date, (counts.get(date) ?? 0) + 1);
  const byDay = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const total = dateByUrl.size;
  const span = Math.max(1, daySpan(byDay[0].date, todayISO()));

  return { total, avgPerDay: Math.round((total / span) * 10) / 10, byDay };
}

/**
 * The activation log only starts recording the day this feature shipped —
 * a returning user with a long history of Drive-saved applications from
 * before that would otherwise see a near-empty chart against a dozen-entry
 * list right below it. Adds one entry per application URL not already in
 * `log`, using the application's `createdAt` date as the best available
 * stand-in for "when the extension was activated on it". Pure (the actual
 * persistence is `local.ts#getUrlActivationsWithBackfill`'s job) so it's
 * testable without touching `chrome.storage`.
 */
export function mergeBackfilledActivations(
  log: UrlActivation[],
  applications: { url: string; createdAt: string }[],
): UrlActivation[] {
  const seen = new Set(log.map((entry) => entry.url));
  const backfilled = applications
    .filter((app) => app.url && !seen.has(app.url))
    .map((app) => ({ url: app.url, date: app.createdAt.slice(0, 10) }));
  return backfilled.length === 0 ? log : [...log, ...backfilled];
}
