import type { Application } from "@/types/application";

/**
 * Time-to-apply, one day at a time (Applications → "Time" view): every
 * application marked applied that day as a start–end bar, plus totals.
 * Pure — the view and its tests feed it the loaded applications.
 */

const HOUR_MS = 60 * 60 * 1000;

export interface DayBar {
  id: string;
  position: string;
  company: string;
  url: string;
  /** Epoch ms, clipped to the day's start when work began on an earlier day. */
  start: number;
  end: number;
  /** The whole application's duration, not just the part on this day. */
  durationMs: number;
  startedEarlier: boolean;
}

export interface DayTimeline {
  /** Local `YYYY-MM-DD`. */
  day: string;
  bars: DayBar[];
  totalMs: number;
  averageMs: number;
  medianMs: number;
  /** Axis bounds (epoch ms): whole hours around the day's bars, at least two hours wide. */
  axisStart: number;
  axisEnd: number;
}

export function localDay(iso: string | number): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayStart(day: string): number {
  return new Date(`${day}T00:00:00`).getTime();
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Days that have at least one timed application, newest first. */
export function daysWithTiming(applications: Application[]): string[] {
  const days = new Set(applications.flatMap((app) => (app.timing ? [localDay(app.timing.submittedAt)] : [])));
  return [...days].sort().reverse();
}

export function computeDayTimeline(applications: Application[], day: string): DayTimeline {
  const from = dayStart(day);
  const to = from + 24 * HOUR_MS;
  const bars: DayBar[] = applications
    .filter((app) => app.timing && localDay(app.timing.submittedAt) === day)
    .map((app) => {
      const timing = app.timing!;
      const rawStart = Date.parse(timing.startedAt);
      const end = Math.min(Date.parse(timing.submittedAt), to);
      return {
        id: app.id,
        position: app.position,
        company: app.company,
        url: app.url,
        start: Math.max(rawStart, from),
        end,
        durationMs: timing.durationMs,
        startedEarlier: rawStart < from,
      };
    })
    .sort((a, b) => a.start - b.start);

  const durations = bars.map((bar) => bar.durationMs);
  const totalMs = durations.reduce((sum, ms) => sum + ms, 0);
  let axisStart = from + 9 * HOUR_MS;
  let axisEnd = from + 18 * HOUR_MS;
  if (bars.length > 0) {
    axisStart = Math.floor(Math.min(...bars.map((b) => b.start)) / HOUR_MS) * HOUR_MS;
    axisEnd = Math.ceil(Math.max(...bars.map((b) => b.end)) / HOUR_MS) * HOUR_MS;
    if (axisEnd - axisStart < 2 * HOUR_MS) axisEnd = Math.min(to, axisStart + 2 * HOUR_MS);
    if (axisEnd - axisStart < 2 * HOUR_MS) axisStart = axisEnd - 2 * HOUR_MS;
  }
  return {
    day,
    bars,
    totalMs,
    averageMs: bars.length ? Math.round(totalMs / bars.length) : 0,
    medianMs: median(durations),
    axisStart,
    axisEnd,
  };
}

/** Median/average over every timed application — the "usually takes" figure. */
export function overallTiming(applications: Application[]): { count: number; averageMs: number; medianMs: number } {
  const durations = applications.flatMap((app) => (app.timing ? [app.timing.durationMs] : []));
  const total = durations.reduce((sum, ms) => sum + ms, 0);
  return { count: durations.length, averageMs: durations.length ? Math.round(total / durations.length) : 0, medianMs: median(durations) };
}

/** "45 s", "12 min", "1 h 05 min", "2 d 3 h". */
export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
