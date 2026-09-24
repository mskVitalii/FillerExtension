import { describe, expect, it, vi } from "vitest";
import { computeSubmissionStats, mergeBackfilledActivations } from "@/features/applications/stats";
import type { UrlActivation } from "@/types/application";

describe("computeSubmissionStats", () => {
  it("returns zeroed stats for no activations", () => {
    expect(computeSubmissionStats([])).toEqual({ total: 0, lastWindow: 0, avgPerDay: 0, byDay: [], series: [] });
  });

  it("groups multiple activations on the same day into one bar", () => {
    vi.setSystemTime(new Date("2026-03-01T12:00:00"));
    const activations: UrlActivation[] = [
      { url: "https://a.example/job/1", date: "2026-03-01" },
      { url: "https://a.example/job/2", date: "2026-03-01" },
      { url: "https://a.example/job/3", date: "2026-02-28" },
    ];
    const stats = computeSubmissionStats(activations);
    expect(stats.total).toBe(3);
    expect(stats.byDay).toEqual([
      { date: "2026-02-28", count: 1 },
      { date: "2026-03-01", count: 2 },
    ]);
    vi.useRealTimers();
  });

  it("dedupes by URL, keeping each URL's earliest date, if the log ever has a repeated URL", () => {
    vi.setSystemTime(new Date("2026-03-01T12:00:00"));
    const activations: UrlActivation[] = [
      { url: "https://a.example/job/1", date: "2026-02-28" },
      { url: "https://a.example/job/1", date: "2026-03-01" },
      { url: "https://a.example/job/2", date: "2026-03-01" },
    ];
    const stats = computeSubmissionStats(activations);
    expect(stats.total).toBe(2);
    expect(stats.byDay).toEqual([
      { date: "2026-02-28", count: 1 },
      { date: "2026-03-01", count: 1 },
    ]);
    vi.useRealTimers();
  });

  it("averages over the trailing 30 days only, so an old burst doesn't linger", () => {
    vi.setSystemTime(new Date("2026-09-24T09:00:00"));
    const activations: UrlActivation[] = [
      // A six-month-old burst: outside the window.
      ...Array.from({ length: 20 }, (_, i) => ({ url: `https://a.example/old/${i}`, date: "2026-03-10" })),
      { url: "https://a.example/job/1", date: "2026-08-26" }, // exactly 30 days incl. today -> inside
      { url: "https://a.example/job/2", date: "2026-08-25" }, // 31 days back -> outside
      { url: "https://a.example/job/3", date: "2026-09-24" },
      { url: "https://a.example/job/4", date: "2026-09-20" },
    ];
    const stats = computeSubmissionStats(activations);
    expect(stats.total).toBe(24);
    expect(stats.lastWindow).toBe(3);
    expect(stats.avgPerDay).toBe(0.1);
    vi.useRealTimers();
  });

  it("builds a zero-filled daily series through today with rolling average and running total", () => {
    vi.setSystemTime(new Date("2026-03-05T09:00:00"));
    const activations: UrlActivation[] = [
      { url: "https://a.example/job/1", date: "2026-03-01" },
      { url: "https://a.example/job/2", date: "2026-03-03" },
      { url: "https://a.example/job/3", date: "2026-03-03" },
    ];
    const { series } = computeSubmissionStats(activations);
    expect(series.map((p) => [p.date, p.count, p.cumulative])).toEqual([
      ["2026-03-01", 1, 1],
      ["2026-03-02", 0, 1],
      ["2026-03-03", 2, 3],
      ["2026-03-04", 0, 3],
      ["2026-03-05", 0, 3],
    ]);
    // Before a full window exists, the mean is over the days seen so far.
    expect(series[2].rolling).toBe(1);
    expect(series[4].rolling).toBeCloseTo(0.6);
    vi.useRealTimers();
  });

  it("drops days from the rolling window once they're more than 30 days old", () => {
    vi.setSystemTime(new Date("2026-04-15T09:00:00"));
    const { series } = computeSubmissionStats([{ url: "https://a.example/job/1", date: "2026-03-01" }]);
    const byDate = new Map(series.map((p) => [p.date, p]));
    expect(byDate.get("2026-03-30")!.rolling).toBeCloseTo(1 / 30);
    expect(byDate.get("2026-03-31")!.rolling).toBe(0);
    expect(series[series.length - 1].cumulative).toBe(1);
    vi.useRealTimers();
  });
});

describe("mergeBackfilledActivations", () => {
  it("adds one entry per application URL not already in the log, dated from createdAt", () => {
    const log: UrlActivation[] = [{ url: "https://a.example/job/1", date: "2026-03-01" }];
    const applications = [
      { url: "https://a.example/job/1", createdAt: "2026-01-01T10:00:00.000Z" }, // already logged
      { url: "https://a.example/job/2", createdAt: "2026-02-15T08:30:00.000Z" },
    ];
    const merged = mergeBackfilledActivations(log, applications);
    expect(merged).toEqual([
      { url: "https://a.example/job/1", date: "2026-03-01" },
      { url: "https://a.example/job/2", date: "2026-02-15" },
    ]);
  });

  it("returns the same array reference when there's nothing to backfill", () => {
    const log: UrlActivation[] = [{ url: "https://a.example/job/1", date: "2026-03-01" }];
    const merged = mergeBackfilledActivations(log, [{ url: "https://a.example/job/1", createdAt: "2026-01-01T00:00:00.000Z" }]);
    expect(merged).toBe(log);
  });

  it("skips applications with no URL", () => {
    const merged = mergeBackfilledActivations([], [{ url: "", createdAt: "2026-01-01T00:00:00.000Z" }]);
    expect(merged).toEqual([]);
  });
});
