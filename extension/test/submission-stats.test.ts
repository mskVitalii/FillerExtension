import { describe, expect, it, vi } from "vitest";
import { computeSubmissionStats, mergeBackfilledActivations } from "@/features/applications/stats";
import type { UrlActivation } from "@/types/application";

describe("computeSubmissionStats", () => {
  it("returns zeroed stats for no activations", () => {
    expect(computeSubmissionStats([])).toEqual({ total: 0, avgPerDay: 0, byDay: [] });
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

  it("computes the average per calendar day from the first activation through today, inclusive", () => {
    vi.setSystemTime(new Date("2026-03-05T09:00:00"));
    const activations: UrlActivation[] = [
      { url: "https://a.example/job/1", date: "2026-03-01" },
      { url: "https://a.example/job/2", date: "2026-03-03" },
      { url: "https://a.example/job/3", date: "2026-03-05" },
    ];
    // 2026-03-01 .. 2026-03-05 is 5 calendar days, 3 submissions -> 0.6/day.
    expect(computeSubmissionStats(activations).avgPerDay).toBe(0.6);
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
