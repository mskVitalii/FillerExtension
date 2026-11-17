import { describe, expect, it } from "vitest";
import type { Application } from "@/types/application";
import { EMPTY_JOB } from "@/types/job";
import { computeDayTimeline, daysWithTiming, formatDuration, overallTiming } from "@/features/applications/day-timeline";
import { timingOnApplied } from "@/features/applications/repository";

function app(id: string, startedAt: string, submittedAt: string): Application {
  const durationMs = new Date(submittedAt).getTime() - new Date(startedAt).getTime();
  return {
    id,
    company: `Co ${id}`,
    position: "Engineer",
    url: `https://example.com/${id}`,
    job: EMPTY_JOB,
    coverLetter: "",
    createdAt: startedAt,
    updatedAt: submittedAt,
    status: "applied",
    timing: { startedAt: new Date(startedAt).toISOString(), submittedAt: new Date(submittedAt).toISOString(), durationMs },
  };
}

// Local times (no Z), so the day boundaries are the test machine's own.
const apps = [
  app("a", "2026-11-17T09:00:00", "2026-11-17T09:10:00"),
  app("b", "2026-11-17T10:00:00", "2026-11-17T10:30:00"),
  app("c", "2026-11-16T23:30:00", "2026-11-17T00:30:00"),
  app("d", "2026-11-15T12:00:00", "2026-11-15T12:20:00"),
  { ...app("e", "2026-11-17T11:00:00", "2026-11-17T11:05:00"), timing: undefined },
];

describe("computeDayTimeline", () => {
  it("lists the day's applications as bars with totals", () => {
    const day = computeDayTimeline(apps, "2026-11-17");
    expect(day.bars.map((bar) => bar.id)).toEqual(["c", "a", "b"]);
    expect(day.totalMs).toBe((10 + 30 + 60) * 60_000);
    expect(day.averageMs).toBe(Math.round((100 * 60_000) / 3));
    expect(day.medianMs).toBe(30 * 60_000);
  });

  it("clips work that started the day before to midnight but keeps its full duration", () => {
    const [c] = computeDayTimeline(apps, "2026-11-17").bars;
    expect(c.startedEarlier).toBe(true);
    expect(c.start).toBe(new Date("2026-11-17T00:00:00").getTime());
    expect(c.durationMs).toBe(60 * 60_000);
  });

  it("spans whole hours around the bars", () => {
    const day = computeDayTimeline([apps[0]], "2026-11-17");
    expect(new Date(day.axisStart).getHours()).toBe(9);
    expect(day.axisEnd - day.axisStart).toBe(2 * 60 * 60_000);
  });

  it("is empty for a day without timed applications", () => {
    const day = computeDayTimeline(apps, "2026-11-10");
    expect(day.bars).toEqual([]);
    expect(day.averageMs).toBe(0);
  });
});

describe("daysWithTiming / overallTiming", () => {
  it("lists days newest first, ignoring untimed records", () => {
    expect(daysWithTiming(apps)).toEqual(["2026-11-17", "2026-11-15"]);
    expect(overallTiming(apps)).toMatchObject({ count: 4, medianMs: 25 * 60_000 });
  });
});

describe("timingOnApplied", () => {
  const now = new Date("2026-11-17T10:00:00.000Z");
  it("measures from the recorded start", () => {
    expect(timingOnApplied(null, "2026-11-17T09:45:00.000Z", now)).toEqual({
      startedAt: "2026-11-17T09:45:00.000Z",
      submittedAt: "2026-11-17T10:00:00.000Z",
      durationMs: 15 * 60_000,
    });
  });
  it("falls back to the record's creation, and never re-times an applied record", () => {
    expect(timingOnApplied({ createdAt: "2026-11-17T09:00:00.000Z" }, undefined, now).durationMs).toBe(60 * 60_000);
    const timing = { startedAt: "x", submittedAt: "y", durationMs: 1 };
    expect(timingOnApplied({ createdAt: "z", timing }, "2026-11-17T09:00:00.000Z", now)).toBe(timing);
  });
});

describe("formatDuration", () => {
  it("reads naturally", () => {
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(65 * 60_000)).toBe("1 h 05 min");
    expect(formatDuration(27 * 60 * 60_000)).toBe("1 d 3 h");
  });
});
