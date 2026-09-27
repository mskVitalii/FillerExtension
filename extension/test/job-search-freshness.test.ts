import { describe, expect, it } from "vitest";
import { dropStalePostings, formatPostedAgo, postingAgeDays } from "@/features/job-search/freshness";
import type { JobSearchResult } from "@/types/job-search";

const NOW = new Date("2026-09-27T12:00:00Z");

function job(postedAt: string | undefined): JobSearchResult {
  return { title: "Engineer", company: "Acme", location: "", url: `https://x/${postedAt}`, salary: "", snippet: "", postedAt, source: "openai" };
}

describe("postingAgeDays", () => {
  it("counts whole days for dates and Adzuna-style timestamps", () => {
    expect(postingAgeDays("2026-09-20", NOW)).toBe(7);
    expect(postingAgeDays("2026-09-27T08:00:00Z", NOW)).toBe(0);
  });

  it("treats missing, unparseable and future dates as unknown", () => {
    expect(postingAgeDays(undefined, NOW)).toBeNull();
    expect(postingAgeDays("", NOW)).toBeNull();
    expect(postingAgeDays("last week", NOW)).toBeNull();
    expect(postingAgeDays("2026-10-05", NOW)).toBeNull();
  });
});

describe("dropStalePostings", () => {
  it("drops postings older than 30 days and keeps undated ones", () => {
    const kept = dropStalePostings([job("2026-09-25"), job("2026-08-28"), job("2026-08-01"), job(""), job(undefined)], NOW);
    expect(kept.map((j) => j.postedAt)).toEqual(["2026-09-25", "2026-08-28", "", undefined]);
  });
});

describe("formatPostedAgo", () => {
  it("renders a short relative age, or nothing when the date is unknown", () => {
    expect(formatPostedAgo("2026-09-27", NOW)).toBe("Posted today");
    expect(formatPostedAgo("2026-09-26", NOW)).toBe("Posted yesterday");
    expect(formatPostedAgo("2026-09-22", NOW)).toBe("Posted 5 days ago");
    expect(formatPostedAgo("2026-09-06", NOW)).toBe("Posted 3 weeks ago");
    expect(formatPostedAgo("", NOW)).toBe("");
  });
});
