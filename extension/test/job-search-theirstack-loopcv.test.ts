import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import {
  buildTheirStackBody,
  cityPattern,
  DAILY_CREDIT_BUDGET,
  mapTheirStackJob,
  searchCountryCode,
  searchTheirStackJobs,
  THEIRSTACK_URL,
  type TheirStackResponse,
} from "@/features/job-search/theirstack-provider";
import { LOOPCV_BASE, loopLevel, loopLocation, mapLoopCvJob, searchLoopCvJobs, type LoopCvJob } from "@/features/job-search/loopcv-provider";
import { mergeSourceResults } from "@/features/job-search/merge-sources";
import { resultSources, sourceLabel } from "@/features/job-search/sources";
import theirstackFixture from "./fixtures/theirstack/search-berlin.json";
import loopcvFixture from "./fixtures/loopcv/matches-berlin.json";

const TS = theirstackFixture as unknown as TheirStackResponse;
const LOOP = loopcvFixture as LoopCvJob[];
const NOW = new Date("2026-11-24T12:00:00Z");

/** A `chrome.storage.local` good enough for the providers' state. */
function stubStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = structuredClone(initial);
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: async (key: string) => (key in store ? { [key]: structuredClone(store[key]) } : {}),
        set: async (items: Record<string, unknown>) => void Object.assign(store, structuredClone(items)),
      },
    },
  });
  return store;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function query(extra: Partial<JobSearchQuery> = {}): JobSearchQuery {
  return { provider: "theirstack", what: "", where: "Berlin, Germany", terms: ["Backend Engineer", "Node.js Developer"], ...extra };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TheirStack request", () => {
  it("asks only for what the agent would apply to: fresh, open, ATS-linked, not easy-apply, in the place, newest first", () => {
    const body = buildTheirStackBody(query({ grades: ["senior"], negative: "no agencies, no crypto" }), { countryCode: "DE", limit: 10, excludeIds: [1, 2] });
    expect(body).toMatchObject({
      job_title_or: ["Backend Engineer", "Node.js Developer"],
      posted_at_max_age_days: 14,
      is_closed: false,
      property_exists_or: ["final_url"],
      easy_apply_or_null: false,
      job_country_code_or: ["DE"],
      job_location_pattern_or: ["berlin"],
      job_seniority_or: ["senior"],
      company_type: "direct_employer",
      job_id_not: [1, 2],
      order_by: [{ field: "date_posted", desc: true }],
      include_total_results: false,
      limit: 10,
      page: 0,
    });
    expect(body.job_title_not).toContain("crypto");
    expect(body).not.toHaveProperty("workplace_types_or");
  });

  it("drops the city for remote only and knows both spellings of a city", () => {
    const body = buildTheirStackBody(query({ where: "Munich, Germany", remoteOnly: true }), { countryCode: "DE", limit: 5, excludeIds: [] });
    expect(body.workplace_types_or).toEqual(["remote"]);
    expect(body).not.toHaveProperty("job_location_pattern_or");
    expect(body).not.toHaveProperty("job_id_not");
    expect(cityPattern("München")).toBe("münchen|munich");
    expect(cityPattern("Germany")).toBe("");
    expect(searchCountryCode("Berlin, Germany")).toBe("DE");
    expect(searchCountryCode("Berlin", "Germany")).toBe("DE");
  });
});

describe("TheirStack results", () => {
  it("links the employer's page first and keeps the listing beside it", () => {
    const [ashby, greenhouse, indeed] = TS.data!.map(mapTheirStackJob);
    expect(ashby).toMatchObject({
      title: "Senior Backend Engineer (TypeScript)",
      company: "ExamplePay GmbH",
      location: "Berlin, Germany",
      url: "https://jobs.ashbyhq.com/examplepay/6a1f2c34-1d2e-4c55-9f7a-0b1c2d3e4f50",
      boardUrl: "https://www.linkedin.com/jobs/view/4071234567",
      salary: "€70,000 - €85,000",
      postedAt: "2026-11-20",
      source: "theirstack",
      sourceIds: { theirstack: "4810235711" },
    });
    expect(ashby.snippet).not.toMatch(/[#*]/);
    expect(greenhouse.boardUrl).toBeUndefined();
    expect(greenhouse.salary).toContain("EUR");
    expect(indeed).toMatchObject({ url: "https://de.indeed.com/viewjob?jk=abc123", boardOnly: true });
  });

  it("spends within the daily budget, never asks for a job twice, and records the credits", async () => {
    const store = stubStorage({ theirstackState: { seen: [111], day: "2026-11-24", credits: DAILY_CREDIT_BUDGET - 4 } });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => json(TS));
    vi.stubGlobal("fetch", fetchMock);
    const shown: JobSearchResult = { ...mapTheirStackJob({ id: 222, job_title: "x", url: "https://example.com/x" }), title: "x" };
    const outcome = await searchTheirStackJobs(query(), "key-123", { exclude: [shown], now: NOW });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(THEIRSTACK_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    const body = JSON.parse(String(init.body));
    expect(body.limit).toBe(4);
    expect(body.job_id_not).toEqual([111, 222]);
    expect(outcome.credits).toBe(3);
    expect(outcome.results.map((r) => r.company)).toEqual(["ExamplePay GmbH", "ExampleData", "ExampleShop"]);
    expect(store.theirstackState).toMatchObject({ day: "2026-11-24", credits: DAILY_CREDIT_BUDGET - 1, seen: [111, 4810235711, 4810235799, 4810230001] });
  });

  it("skips without a request once the day's budget is used, and starts again the next day", async () => {
    stubStorage({ theirstackState: { seen: [], day: "2026-11-24", credits: DAILY_CREDIT_BUDGET } });
    const fetchMock = vi.fn(async () => json({ data: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const today = await searchTheirStackJobs(query(), "k", { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(today.warnings[0]).toMatch(/budget/);
    await searchTheirStackJobs(query(), "k", { now: new Date("2026-11-25T08:00:00Z") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("doesn't pay for the whole world: no place and not remote is skipped", async () => {
    stubStorage();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await searchTheirStackJobs(query({ where: "" }), "k", { now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(outcome.warnings[0]).toMatch(/country or city/);
  });

  it("says what went wrong: out of credits, bad key", async () => {
    stubStorage();
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { title: "Payment required" } }, 402)));
    await expect(searchTheirStackJobs(query(), "k", { now: NOW })).rejects.toThrow(/402 \(out of API credits\)/);
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: { title: "Not authenticated" } }, 401)));
    await expect(searchTheirStackJobs(query(), "k", { now: NOW })).rejects.toThrow(/401 \(check the API key\)/);
  });
});

describe("LoopCV", () => {
  it("maps grades onto its three levels and places onto 'city, country'", () => {
    expect(loopLevel(["senior"])).toBe("Senior");
    expect(loopLevel(["junior", "student"])).toBe("Junior");
    expect(loopLevel([])).toBe("Associate");
    expect(loopLocation("Berlin, Germany")).toBe("Berlin, Germany");
    expect(loopLocation("Berlin", "Germany")).toBe("Berlin, Germany");
    expect(loopLocation("Netherlands")).toBe("Netherlands");
  });

  it("links the apply page first; a job-board-only listing is marked", () => {
    const [greenhouse, indeed, career] = LOOP.map((j) => mapLoopCvJob(j, "Backend Engineer"));
    expect(greenhouse).toMatchObject({
      url: "https://boards.greenhouse.io/exampledata/jobs/7712345",
      boardUrl: "https://www.linkedin.com/jobs/view/4079999999",
      source: "loopcv",
      sourceIds: { loopcv: "6740f1a2b3c4d5e6f7a8b9c0" },
      tag: "Backend Engineer",
      snippet: "We are hiring a backend developer. Node.js, AWS.",
    });
    expect(indeed.boardOnly).toBe(true);
    expect(career.boardOnly).toBeUndefined();
    expect(career.url).toBe("https://examplecloud.example/careers/platform-engineer");
  });

  it("sets up a loop per term on first use, says the jobs come later, and reuses it next time", async () => {
    const store = stubStorage();
    const calls: string[] = [];
    let n = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.replace(LOOPCV_BASE, "")}`);
      expect((init.headers as Record<string, string>)["X-API-KEY"]).toBe("loop-key");
      if (init.method === "POST") {
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({ location: "Berlin, Germany", type: "Full-time", level: "Associate" });
        return json({ loopId: `loop-${++n}` });
      }
      return json(n > 0 && calls.length > 4 ? LOOP : []);
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await searchLoopCvJobs(query({ provider: "loopcv" }), "loop-key", { now: NOW });
    expect(calls).toEqual(["POST /loop", "GET /loop/loop-1/matches", "POST /loop", "GET /loop/loop-2/matches"]);
    expect(first.results).toEqual([]);
    expect(first.warnings.join(" ")).toMatch(/several times a day/);
    expect(Object.keys(store.loopcvLoops as object)).toHaveLength(2);

    const second = await searchLoopCvJobs(query({ provider: "loopcv" }), "loop-key", { now: NOW });
    expect(calls.slice(4)).toEqual(["GET /loop/loop-1/matches", "GET /loop/loop-2/matches"]);
    // The same three postings under both terms are shown once.
    expect(second.results).toHaveLength(3);
    expect(second.warnings).toEqual([]);
    expect((await searchLoopCvJobs(query({ provider: "loopcv" }), "loop-key", { page: 2, now: NOW })).results).toEqual([]);
  });

  it("deletes the least recently used loop beyond six", async () => {
    const loops = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`old${i}|berlin, germany|associate`, { loopId: `old-${i}`, createdAt: "2026-11-01T00:00:00Z", usedAt: `2026-11-0${i + 1}T00:00:00Z` }]),
    );
    const store = stubStorage({ loopcvLoops: loops });
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push(`${init.method} ${url.replace(LOOPCV_BASE, "")}`);
        return init.method === "POST" ? json({ loopId: "new" }) : json([]);
      }),
    );
    await searchLoopCvJobs(query({ provider: "loopcv", terms: ["Go Developer"] }), "k", { now: NOW });
    expect(calls).toContain("DELETE /loop/old-0");
    const kept = Object.values(store.loopcvLoops as Record<string, { loopId: string }>).map((l) => l.loopId);
    expect(kept).toHaveLength(6);
    expect(kept).toContain("new");
    expect(kept).not.toContain("old-0");
  });

  it("fails as a whole only when every term failed", async () => {
    stubStorage();
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "Unauthorized" }, 401)));
    await expect(searchLoopCvJobs(query({ provider: "loopcv" }), "bad", { now: NOW })).rejects.toThrow(/401 \(check the API key\)/);
  });
});

describe("Across sources", () => {
  it("shows a posting found by TheirStack and LoopCV once, with both chips and both ids", () => {
    const fromTheirStack = TS.data!.map(mapTheirStackJob);
    const fromLoop = LOOP.map((j) => mapLoopCvJob(j));
    const merged = mergeSourceResults(fromTheirStack, fromLoop);
    const greenhouse = merged.filter((r) => r.url === "https://boards.greenhouse.io/exampledata/jobs/7712345");
    expect(greenhouse).toHaveLength(1);
    expect(resultSources(greenhouse[0]!)).toEqual(["theirstack", "loopcv"]);
    expect(greenhouse[0]!.sourceIds).toEqual({ theirstack: "4810235799", loopcv: "6740f1a2b3c4d5e6f7a8b9c0" });
    expect(sourceLabel("theirstack")).toBe("TheirStack");
    expect(sourceLabel("loopcv")).toBe("LoopCV");
  });
});
