import { todayISO } from "@/lib/date-format";
import type { UrlActivation } from "@/types/application";

/** Trailing window for the "per month" average — a returning user's months-long gap shouldn't drag it toward zero forever. */
export const ROLLING_WINDOW_DAYS = 30;

export interface SubmissionPoint {
  /** `YYYY-MM-DD`, local calendar day. */
  date: string;
  count: number;
  /** Mean submissions/day over the trailing {@link ROLLING_WINDOW_DAYS} days (fewer at the very start of the history). */
  rolling: number;
  /** Running total through this day. */
  cumulative: number;
}

export interface SubmissionStats {
  total: number;
  /** Unique submissions in the last {@link ROLLING_WINDOW_DAYS} days, today included. */
  lastWindow: number;
  /** `lastWindow / ROLLING_WINDOW_DAYS`, one decimal. */
  avgPerDay: number;
  /** Counts grouped by day, ascending — only days that had at least one submission. */
  byDay: { date: string; count: number }[];
  /** One point per calendar day from the first submission through today, zero-filled — what the chart plots. */
  series: SubmissionPoint[];
}

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}

function formatDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Every `YYYY-MM-DD` from `first` through `last`, inclusive. Steps by calendar date, not by 24h, so DST shifts don't skip or repeat a day. */
function eachDay(first: string, last: string): string[] {
  const days: string[] = [];
  const cursor = parseDay(first);
  const end = parseDay(last).getTime();
  while (cursor.getTime() <= end) {
    days.push(formatDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
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
  if (activations.length === 0) return { total: 0, lastWindow: 0, avgPerDay: 0, byDay: [], series: [] };

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

  const today = todayISO();
  // A clock set backwards (or a future-dated backfill) must not produce an empty range.
  const last = byDay[byDay.length - 1].date > today ? byDay[byDay.length - 1].date : today;
  const days = eachDay(byDay[0].date, last);
  const daily = days.map((date) => counts.get(date) ?? 0);

  const series: SubmissionPoint[] = [];
  let windowSum = 0;
  let cumulative = 0;
  daily.forEach((count, i) => {
    windowSum += count;
    if (i >= ROLLING_WINDOW_DAYS) windowSum -= daily[i - ROLLING_WINDOW_DAYS];
    cumulative += count;
    const windowLength = Math.min(i + 1, ROLLING_WINDOW_DAYS);
    series.push({ date: days[i], count, rolling: windowSum / windowLength, cumulative });
  });

  const windowStartDate = parseDay(today);
  windowStartDate.setDate(windowStartDate.getDate() - (ROLLING_WINDOW_DAYS - 1));
  const windowStart = formatDay(windowStartDate);
  const lastWindow = byDay.filter((d) => d.date >= windowStart && d.date <= today).reduce((sum, d) => sum + d.count, 0);

  return {
    total: dateByUrl.size,
    lastWindow,
    avgPerDay: Math.round((lastWindow / ROLLING_WINDOW_DAYS) * 10) / 10,
    byDay,
    series,
  };
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
