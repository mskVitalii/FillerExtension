import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSearchQuery } from "@/types/job-search";

const requestStructured = vi.fn();
vi.mock("@/features/openai/client", () => ({
  requestStructured: (...args: unknown[]) => requestStructured(...args),
  requestWithWebSearch: vi.fn(),
}));

const { buildOpenAiSearchPrompt } = await import("@/features/job-search/openai-provider");
const { buildTavilyRequest } = await import("@/features/job-search/tavily-provider");
const { buildAdzunaUrl, searchAdzunaJobs } = await import("@/features/job-search/adzuna-provider");
const { extractJobListings } = await import("@/features/openai/extract-job-listings");

const NEGATIVE = "no crypto, no on-site only, no linkedin.com";

function query(extra: Partial<JobSearchQuery> = {}): JobSearchQuery {
  return { provider: "openai", what: "backend engineer", where: "Berlin", ...extra };
}

describe("OpenAI provider prompt", () => {
  it("carries the negative prompt as an exclusion next to the already-shown list", () => {
    const prompt = buildOpenAiSearchPrompt(query({ negative: NEGATIVE }), "Go developer", [
      { title: "Old", company: "Acme", location: "", url: "https://a/1", salary: "", snippet: "", source: "openai" },
    ]);
    expect(prompt).toContain(`does NOT want postings that match any of the following`);
    expect(prompt).toContain(`"${NEGATIVE}"`);
    expect(prompt).toContain("https://a/1");
  });

  it("says nothing about exclusions without one", () => {
    expect(buildOpenAiSearchPrompt(query(), "")).not.toContain("does NOT want");
  });
});

describe("Tavily request", () => {
  it("puts the negative prompt in the query and domains in exclude_domains", () => {
    const body = buildTavilyRequest(query({ provider: "tavily", negative: NEGATIVE }), "key", "x".repeat(5000));
    expect(body.query).toContain(`"${NEGATIVE}"`);
    // The background is what gets cut by the length cap, not the exclusion.
    expect((body.query as string).length).toBeLessThanOrEqual(2000);
    expect(body.exclude_domains).toEqual(["linkedin.com"]);
  });

  it("sends no exclude_domains without a domain term", () => {
    expect(buildTavilyRequest(query({ negative: "no crypto" }), "key", "")).not.toHaveProperty("exclude_domains");
  });
});

describe("Adzuna request", () => {
  const creds = { appId: "id", appKey: "key" };

  it("maps single-word terms to what_exclude", () => {
    const url = new URL(buildAdzunaUrl("go developer", query({ negative: NEGATIVE }), creds, "de", 2));
    expect(url.pathname).toBe("/v1/api/jobs/de/search/2");
    expect(url.searchParams.get("what")).toBe("go developer");
    expect(url.searchParams.get("what_exclude")).toBe("crypto cryptos");
  });

  it("omits what_exclude without a usable word", () => {
    const url = new URL(buildAdzunaUrl("go developer", query({ negative: "no on-site only" }), creds, "de", 1));
    expect(url.searchParams.has("what_exclude")).toBe(false);
  });
});

describe("parse pass", () => {
  beforeEach(() => requestStructured.mockReset().mockResolvedValue({ jobs: [] }));

  it("tells the parser to drop excluded postings, at low reasoning effort", async () => {
    await extractJobListings("raw", "openai", "background", "no crypto");
    const request = requestStructured.mock.calls[0][0] as { systemPrompt: string; reasoningEffort: string };
    expect(request.systemPrompt).toContain('"no crypto"');
    expect(request.reasoningEffort).toBe("low");
  });

  it("adds no exclusion rule without a negative prompt", async () => {
    await extractJobListings("raw", "openai");
    expect((requestStructured.mock.calls[0][0] as { systemPrompt: string }).systemPrompt).not.toContain("does NOT want");
  });
});

describe("searchAdzunaJobs", () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let attempts: Record<string, number> = {};

  function respond(tag: string): Response {
    const results = [
      { title: `${tag} 1`, redirect_url: `https://adzuna/${tag}/1` },
      { title: "shared", redirect_url: "https://adzuna/shared" },
    ];
    return new Response(JSON.stringify({ results }), { status: 200 });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    inFlight = 0;
    maxInFlight = 0;
    attempts = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const tag = new URL(input).searchParams.get("what")!;
        attempts[tag] = (attempts[tag] ?? 0) + 1;
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Later tags answer sooner, so arrival order differs from tag order.
        await new Promise((resolve) => setTimeout(resolve, 2000 - tag.length * 100));
        inFlight--;
        if (tag === "limited" && attempts[tag] === 1) return new Response("slow down", { status: 429 });
        if (tag === "broken") return new Response("nope", { status: 500 });
        return respond(tag);
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs a few tags at once, streams each tag's new results, and keeps tag order in the result", async () => {
    const tags = ["a", "bb", "ccc", "dddd", "limited", "broken"];
    const streamed: string[] = [];
    const outcome = searchAdzunaJobs(query({ provider: "adzuna", tags }), { appId: "i", appKey: "k" }, "de", 1, (jobs) =>
      streamed.push(...jobs.map((j) => j.url)),
    );
    await vi.runAllTimersAsync();
    const { results, warnings } = await outcome;

    expect(maxInFlight).toBe(3);
    expect(attempts.limited).toBe(2);
    expect(results.map((r) => r.url)).toEqual([
      "https://adzuna/a/1",
      "https://adzuna/shared",
      "https://adzuna/bb/1",
      "https://adzuna/ccc/1",
      "https://adzuna/dddd/1",
      "https://adzuna/limited/1",
    ]);
    expect(results.find((r) => r.url === "https://adzuna/shared")?.tag).toBe("a");
    // Every result was streamed exactly once, whatever order the tags answered in.
    expect([...streamed].sort()).toEqual(results.map((r) => r.url).sort());
    expect(warnings).toEqual([expect.stringContaining('"broken"')]);
  });
});
