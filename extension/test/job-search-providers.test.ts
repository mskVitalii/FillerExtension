import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSearchQuery } from "@/types/job-search";

const requestStructured = vi.fn();
const streamWithWebSearch = vi.fn();
vi.mock("@/features/openai/client", () => ({
  requestStructured: (...args: unknown[]) => requestStructured(...args),
  streamWithWebSearch: (...args: unknown[]) => streamWithWebSearch(...args),
}));

const { buildOpenAiSearchPrompt, searchOpenAiJobs, MAX_OPENAI_RESULTS } = await import("@/features/job-search/openai-provider");
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

  it("asks for a capped number of JSON Lines", () => {
    const prompt = buildOpenAiSearchPrompt(query(), "");
    expect(prompt).toContain(`Up to ${MAX_OPENAI_RESULTS} of the best matches`);
    expect(prompt).toContain("one JSON object per line");
  });
});

describe("searchOpenAiJobs", () => {
  beforeEach(() => {
    streamWithWebSearch.mockReset();
    requestStructured.mockReset();
  });

  function streams(chunks: string[]) {
    streamWithWebSearch.mockImplementation(async (_prompt: string, onDelta: (d: string) => void) => {
      for (const chunk of chunks) onDelta(chunk);
      return chunks.join("");
    });
  }

  it("emits each posting as soon as its line is complete, with no parse call", async () => {
    const line = (n: number, extra = "") => `{"title":"Go dev ${n}","company":"Acme","location":"","url":"https://jobs.lever.co/acme/${n}","salary":"","postedAt":"${extra}","snippet":"fits"}`;
    const lines = [line(1), line(2, "2020-01-01"), line(1), line(3)];
    // Split mid-object and mid-line, the way SSE deltas arrive.
    const text = `${lines.join("\n")}`;
    const emitted: string[][] = [];
    streams([text.slice(0, 40), text.slice(40, 200), text.slice(200)]);
    const stages: { label: string; ms: number }[] = [];
    const results = await searchOpenAiJobs(query(), "bg", [], stages, (jobs) => emitted.push(jobs.map((j) => j.title)));

    // The stale and the duplicate posting are dropped.
    expect(results.map((r) => r.title)).toEqual(["Go dev 1", "Go dev 3"]);
    expect(emitted).toEqual([["Go dev 1"], ["Go dev 3"]]);
    expect(results[0].source).toBe("openai");
    expect(requestStructured).not.toHaveBeenCalled();
    expect(stages.map((s) => s.label)).toEqual(["Web search", "First result"]);
  });

  it("falls back to the parse pass when the model answers in prose", async () => {
    streams(["Here are some roles:\n1. Go developer at Acme — https://acme.dev/jobs/1"]);
    requestStructured.mockResolvedValue({
      jobs: [{ title: "Go developer", company: "Acme", location: "", url: "https://acme.dev/jobs/1", salary: "", snippet: "", postedAt: "" }],
    });
    const stages: { label: string; ms: number }[] = [];
    const results = await searchOpenAiJobs(query({ negative: "no crypto" }), "bg", [], stages);
    expect(results.map((r) => r.url)).toEqual(["https://acme.dev/jobs/1"]);
    const request = requestStructured.mock.calls[0][0] as { systemPrompt: string; reasoningEffort: string };
    expect(request.systemPrompt).toContain('"no crypto"');
    expect(request.reasoningEffort).toBe("low");
    expect(stages.map((s) => s.label)).toEqual(["Web search", "Parse results"]);
  });

  it("returns nothing, without a parse call, when the model wrote nothing", async () => {
    streams([]);
    expect(await searchOpenAiJobs(query(), "bg")).toEqual([]);
    expect(requestStructured).not.toHaveBeenCalled();
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

  it("tells the parser to drop excluded postings, at the model's default effort unless asked", async () => {
    await extractJobListings("raw", "tavily", "background", { negative: "no crypto" });
    const request = requestStructured.mock.calls[0][0] as { systemPrompt: string; reasoningEffort?: string };
    expect(request.systemPrompt).toContain('"no crypto"');
    expect(request.reasoningEffort).toBeUndefined();
  });

  it("adds no exclusion rule without a negative prompt", async () => {
    await extractJobListings("raw", "openai");
    expect((requestStructured.mock.calls[0][0] as { systemPrompt: string }).systemPrompt).not.toContain("does NOT want");
  });
});

describe("searchAdzunaJobs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const tag = new URL(input).searchParams.get("what")!;
        if (tag === "broken") return new Response("nope", { status: 500 });
        const results = [
          { title: `${tag} 1`, redirect_url: `https://adzuna/${tag}/1` },
          { title: "shared", redirect_url: "https://adzuna/shared" },
        ];
        return new Response(JSON.stringify({ results }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs tags one by one and streams each tag's new results", async () => {
    const streamed: string[][] = [];
    const outcome = searchAdzunaJobs(query({ provider: "adzuna", tags: ["a", "broken", "b"] }), { appId: "i", appKey: "k" }, "de", 1, (jobs) =>
      streamed.push(jobs.map((j) => j.url)),
    );
    await vi.runAllTimersAsync();
    const { results, warnings } = await outcome;

    expect(results.map((r) => r.url)).toEqual(["https://adzuna/a/1", "https://adzuna/shared", "https://adzuna/b/1"]);
    expect(streamed).toEqual([["https://adzuna/a/1", "https://adzuna/shared"], ["https://adzuna/b/1"]]);
    expect(warnings).toEqual([expect.stringContaining('"broken"')]);
  });
});
