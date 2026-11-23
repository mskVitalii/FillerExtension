import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSearchQuery } from "@/types/job-search";

const requestStructured = vi.fn();
const streamWithWebSearch = vi.fn();
vi.mock("@/features/openai/client", () => ({
  requestStructured: (...args: unknown[]) => requestStructured(...args),
  streamWithWebSearch: (...args: unknown[]) => streamWithWebSearch(...args),
}));

const { buildOpenAiSearchPrompt, searchOpenAiJobs, MAX_OPENAI_RESULTS, OPENAI_SEARCH_SHARDS } = await import("@/features/job-search/openai-provider");
const { buildTavilyQuery, buildTavilyRequest, mergeTavilyHits, searchTavilyJobs, tavilyCountry, tavilyPlan, tavilyRounds, tavilyVariants, MAX_TAVILY_QUERIES, MAX_TAVILY_QUERY_LENGTH } = await import("@/features/job-search/tavily-provider");
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

  it("asks for any of the search terms", () => {
    const prompt = buildOpenAiSearchPrompt(query({ terms: ["go developer", "Backend engineer", "go developer "] }), "");
    expect(prompt).toContain('Role/keywords: any of "go developer", "Backend engineer".');
    expect(prompt).not.toContain('"backend engineer".');
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

  const line = (n: number, extra = "", company = "Acme") =>
    `{"title":"Go dev ${n}","company":"${company}","location":"","url":"https://jobs.lever.co/acme/${n}${company === "Acme" ? "" : "-b"}","salary":"","postedAt":"${extra}","snippet":"fits"}`;

  /** Each shard (recognized by its focus line in the prompt) streams its own chunks. */
  function streams(byShard: Record<string, string[] | Error>) {
    streamWithWebSearch.mockImplementation(async (prompt: string, onDelta: (d: string) => void) => {
      const shard = OPENAI_SEARCH_SHARDS.find((s) => prompt.includes(s.focus))!;
      const chunks = byShard[shard.id] ?? [];
      if (chunks instanceof Error) throw chunks;
      for (const chunk of chunks) onDelta(chunk);
      return chunks.join("");
    });
  }

  it("runs every shard in parallel at low effort and tells each where to look", async () => {
    streams({});
    await searchOpenAiJobs(query(), "bg");
    expect(streamWithWebSearch).toHaveBeenCalledTimes(OPENAI_SEARCH_SHARDS.length);
    for (const [i, shard] of OPENAI_SEARCH_SHARDS.entries()) {
      expect(streamWithWebSearch.mock.calls[i][0]).toContain(shard.focus);
      expect(streamWithWebSearch.mock.calls[i][2]).toMatchObject({ reasoningEffort: "low", timeoutMs: expect.any(Number), idleMs: expect.any(Number) });
    }
  });

  it("emits each posting as soon as its line is complete, dropping stale ones and duplicates across shards", async () => {
    const text = [line(1), line(2, "2020-01-01"), line(1), line(3)].join("\n");
    // Split mid-object and mid-line, the way SSE deltas arrive.
    streams({ ats: [text.slice(0, 40), text.slice(40, 200), text.slice(200)], boards: [line(3, "", "Acme") + "\n", line(4, "", "Beta")] });
    const emitted: string[] = [];
    const stages: { label: string; ms: number }[] = [];
    const { results, warnings } = await searchOpenAiJobs(query(), "bg", [], stages, (jobs) => emitted.push(...jobs.map((j) => j.title)));

    expect(results.map((r) => r.title).sort()).toEqual(["Go dev 1", "Go dev 3", "Go dev 4"]);
    expect(emitted.sort()).toEqual(["Go dev 1", "Go dev 3", "Go dev 4"]);
    expect(results[0].source).toBe("openai");
    expect(warnings).toEqual([]);
    expect(requestStructured).not.toHaveBeenCalled();
    expect(stages.map((s) => s.label)).toContain("First result");
  });

  it("falls back to the parse pass when the model answers in prose", async () => {
    streams({ careers: ["Here are some roles:\n1. Go developer at Acme — https://acme.dev/jobs/1"] });
    requestStructured.mockResolvedValue({
      jobs: [{ title: "Go developer", company: "Acme", location: "", url: "https://acme.dev/jobs/1", salary: "", snippet: "", postedAt: "" }],
    });
    const stages: { label: string; ms: number }[] = [];
    const { results } = await searchOpenAiJobs(query({ negative: "no crypto" }), "bg", [], stages);
    expect(results.map((r) => r.url)).toEqual(["https://acme.dev/jobs/1"]);
    const request = requestStructured.mock.calls[0][0] as { systemPrompt: string; reasoningEffort: string };
    expect(request.systemPrompt).toContain('"no crypto"');
    expect(request.reasoningEffort).toBe("low");
    expect(stages.map((s) => s.label)).toContain("Parse results");
  });

  it("returns nothing, without a parse call, when the model wrote nothing", async () => {
    streams({});
    expect(await searchOpenAiJobs(query(), "bg")).toEqual({ results: [], warnings: [] });
    expect(requestStructured).not.toHaveBeenCalled();
  });
});

describe("searchOpenAiJobs when a shard fails", () => {
  beforeEach(() => {
    streamWithWebSearch.mockReset();
  });
  const posting = `{"title":"Go dev","company":"Acme","location":"","url":"https://jobs.lever.co/acme/1","salary":"","postedAt":"","snippet":"fits"}\n`;

  it("keeps what the other shards and the failing one already found, with a warning", async () => {
    streamWithWebSearch.mockImplementation(async (prompt: string, onDelta: (d: string) => void) => {
      if (prompt.includes(OPENAI_SEARCH_SHARDS[0].focus)) {
        onDelta(posting);
        throw new Error("OpenAI web search timed out after 90 s.");
      }
      if (prompt.includes(OPENAI_SEARCH_SHARDS[1].focus)) throw new Error("OpenAI web search request failed (500)");
      return "";
    });
    const { results, warnings } = await searchOpenAiJobs(query(), "bg");
    expect(results.map((r) => r.title)).toEqual(["Go dev"]);
    expect(warnings).toEqual([expect.stringMatching(/ats.*timed out after 90 s/), expect.stringMatching(/careers.*500/)]);
  });

  it("throws when every shard failed and nothing came in", async () => {
    streamWithWebSearch.mockRejectedValue(new Error("OpenAI web search request failed (401)"));
    await expect(searchOpenAiJobs(query(), "bg")).rejects.toThrow(/401/);
  });
});

describe("Tavily request", () => {
  it("is a short keyword query per term: no candidate background, no exclusions, no already-shown list", () => {
    const body = buildTavilyRequest(query({ provider: "tavily", negative: NEGATIVE, remoteOnly: true, grades: ["senior", "lead"] }), "go developer", "key");
    expect(body.query).toBe('"go developer" jobs Berlin remote senior lead');
    expect(body.exclude_domains).toEqual(["linkedin.com"]);
  });

  it("stays within Tavily's limit whatever the term and the place", () => {
    const q = buildTavilyQuery("x".repeat(5000), { where: "y".repeat(5000), remoteOnly: true, grades: ["junior", "senior"] });
    expect(q.length).toBeLessThanOrEqual(MAX_TAVILY_QUERY_LENGTH);
    expect(q.startsWith('"x')).toBe(true);
    expect(MAX_TAVILY_QUERY_LENGTH).toBeLessThan(400);
  });

  it("doesn't repeat a grade the term already names", () => {
    expect(buildTavilyQuery("Senior Go developer", { where: "", grades: ["senior"] })).toBe('"Senior Go developer" jobs');
  });

  it("each round runs other queries per term (Tavily has no pages): broad, the ATS host groups, local wording", () => {
    expect(tavilyVariants(1)).toEqual(["jobs", "ats"]);
    expect(tavilyPlan(2)).toEqual([{ variant: "ats", hosts: ["job-boards.greenhouse.io", "boards.greenhouse.io"] }, { variant: "ats", hosts: ["jobs.lever.co"] }]);
    expect(tavilyPlan(5).map((p) => p.variant)).toEqual(["ats", "local"]);
    expect(tavilyVariants(6)).toEqual(tavilyVariants(1));
    const q = query({ provider: "tavily", where: "Germany" });
    // On the ATS: no country boost (Tavily answers nothing with both), no time range (it cut 20 hits to 2-9).
    const ats = buildTavilyRequest(q, "go developer", "key", "ats");
    expect(ats).toMatchObject({ query: "go developer Germany", search_depth: "basic" });
    expect(ats.include_domains).toContain("join.com");
    for (const key of ["include_domains_mode", "country", "time_range"]) expect(ats).not.toHaveProperty(key);
    expect(buildTavilyRequest(q, "go developer", "key", "ats", undefined, ["jobs.lever.co"]).include_domains).toEqual(["jobs.lever.co"]);
    expect(buildTavilyRequest(q, "go developer", "key", "jobs")).toMatchObject({ include_domains_mode: "prefer", search_depth: "advanced", country: "germany" });
    expect(buildTavilyRequest(q, "go developer", "key", "jobs")).not.toHaveProperty("time_range");
    expect(buildTavilyQuery("go developer", { where: "Germany" }, "local")).toBe('"go developer" (m/w/d) Germany');
    expect(buildTavilyQuery("go developer", { where: "Lisbon" }, "local")).toBe('"go developer" job opening Lisbon');
  });

  it("a country-wide search goes on round by round through its big cities, two at a time, then starts over", () => {
    expect(tavilyRounds("Germany")).toBe(13);
    expect(tavilyPlan(6, "Germany")).toEqual([{ variant: "city", place: "Berlin" }, { variant: "city", place: "Munich" }]);
    expect(tavilyPlan(7, "Germany")).toEqual([{ variant: "city", place: "Hamburg" }, { variant: "city", place: "Frankfurt" }]);
    expect(tavilyPlan(14, "Germany")).toEqual(tavilyPlan(1, "Germany"));
    // A city search, or a place without a list, has no city rounds.
    expect(tavilyRounds("Berlin")).toBe(5);
    expect(tavilyPlan(6, "Berlin")).toEqual(tavilyPlan(1, "Berlin"));
    const body = buildTavilyRequest(query({ provider: "tavily", where: "Germany" }), "go developer", "key", "city", "Munich");
    expect(body).toMatchObject({ query: "go developer Munich", search_depth: "basic" });
    expect(body).not.toHaveProperty("country");
  });

  it("boosts the searched country", () => {
    expect(tavilyCountry("Germany")).toBe("germany");
    expect(tavilyCountry("Berlin")).toBe("germany");
    expect(tavilyCountry("Wien, Österreich")).toBe("austria");
    expect(tavilyCountry("London, UK")).toBe("united kingdom");
    expect(tavilyCountry("Lisbon")).toBe("");
  });

  it("sends no exclude_domains without a domain term", () => {
    expect(buildTavilyRequest(query({ negative: "no crypto" }), "go developer", "key")).not.toHaveProperty("exclude_domains");
  });

  it("merges hits term by term, without repeats or postings already shown", () => {
    const hit = (url: string) => ({ title: url, url, content: "" });
    const merged = mergeTavilyHits(
      [[hit("https://a/1"), hit("https://a/2"), hit("https://a/3")], [hit("https://a/1/"), hit("https://b/1")]],
      [{ title: "", company: "", location: "", url: "https://a/2", salary: "", snippet: "", source: "tavily" }],
      3,
    );
    expect(merged.map((h) => h.url)).toEqual(["https://a/1", "https://b/1", "https://a/3"]);
  });
});

describe("searchTavilyJobs", () => {
  beforeEach(() => requestStructured.mockReset().mockResolvedValue({ jobs: [] }));
  afterEach(() => vi.unstubAllGlobals());

  function stubTavily(byTerm: Record<string, { url: string }[] | number>) {
    const queries: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { query: string };
        queries.push(body.query);
        const term = /^"([^"]+)"/.exec(body.query)?.[1] ?? body.query.replace(/ (Berlin|Germany)$/, "");
        const answer = byTerm[term] ?? [];
        if (typeof answer === "number") return new Response("bad", { status: answer });
        return new Response(JSON.stringify({ results: answer.map((r) => ({ title: "Go dev", content: "fits", ...r })) }), { status: 200 });
      }),
    );
    return queries;
  }

  it("searches every term and parses the merged hits once, with the background", async () => {
    const queries = stubTavily({ "go developer": [{ url: "https://a/1" }], "backend engineer": [{ url: "https://a/1" }, { url: "https://b/1" }] });
    const background = "y".repeat(20_000);
    const { warnings } = await searchTavilyJobs(query({ provider: "tavily", terms: ["go developer", "backend engineer"] }), "key", background);
    expect(queries.sort()).toEqual(['"backend engineer" jobs Berlin', '"go developer" jobs Berlin', "backend engineer Berlin", "go developer Berlin"]);
    expect(requestStructured).toHaveBeenCalledTimes(1);
    const request = requestStructured.mock.calls[0][0] as { userPrompt?: string; systemPrompt: string };
    const prompt = JSON.stringify(request);
    expect(prompt).toContain(background);
    expect(prompt.match(/https:\/\/a\/1/g)).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it("parses many hits in batches, each told where the search is, so none is cut off", async () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({ url: `https://a/${i}` }));
    stubTavily({ "go developer": hits });
    requestStructured.mockImplementation(async (...a: unknown[]) => { const req = a[0] as { userPrompt: string } | undefined; return { jobs: [...(req?.userPrompt ?? "").matchAll(/URL: (\S+)/g)].map((m) => ({ title: "t", company: "c", location: "Berlin", url: m[1], salary: "", snippet: "", postedAt: "" })) }; });
    const { results } = await searchTavilyJobs(query({ provider: "tavily", terms: ["go developer"], where: "Germany" }), "key", "");
    expect(requestStructured.mock.calls.length).toBe(2);
    expect(results).toHaveLength(20);
    expect((requestStructured.mock.calls[0][0] as { systemPrompt: string }).systemPrompt).toContain('jobs in "Germany". Drop every posting whose workplace is outside Germany');
  });

  it("turns a failing term into a warning, and every term failing into an error", async () => {
    stubTavily({ "go developer": [{ url: "https://a/1" }], broken: 400 });
    const { warnings } = await searchTavilyJobs(query({ provider: "tavily", terms: ["go developer", "broken"] }), "key", "");
    expect(warnings).toEqual([expect.stringMatching(/^"broken" — Tavily search failed \(400\)/)]);

    stubTavily({ broken: 401 });
    await expect(searchTavilyJobs(query({ provider: "tavily", terms: ["broken"] }), "key", "")).rejects.toThrow(/401/);
  });

  it("falls back to the single `what` and caps the number of terms", async () => {
    const queries = stubTavily({});
    await searchTavilyJobs(query({ provider: "tavily" }), "key", "");
    expect(queries.sort()).toEqual(['"backend engineer" jobs Berlin', "backend engineer Berlin"]);

    const many = Array.from({ length: MAX_TAVILY_QUERIES + 2 }, (_, i) => `term ${i}`);
    const capped = stubTavily({});
    const { warnings } = await searchTavilyJobs(query({ provider: "tavily", terms: many }), "key", "");
    expect(capped).toHaveLength(MAX_TAVILY_QUERIES * 2);
    expect(warnings).toEqual([expect.stringContaining(`first ${MAX_TAVILY_QUERIES} of ${many.length}`)]);
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

  it("runs one request per search term when no tags were resolved", async () => {
    const outcome = searchAdzunaJobs(query({ provider: "adzuna", terms: ["a", "b"] }), { appId: "i", appKey: "k" }, "de");
    await vi.runAllTimersAsync();
    expect((await outcome).results.map((r) => r.tag)).toEqual(["a", "a", "b"]);
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

describe("searchTavilyJobs when the parse pass fails", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the raw hits with their dates read from Tavily's format", async () => {
    requestStructured.mockReset().mockRejectedValue(new Error("parse timed out"));
    const recent = new Date(Date.now() - 2 * 86_400_000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ results: [{ title: "Go dev", url: "https://a/1", content: "fits", published_date: recent.toUTCString() }] }), { status: 200 })),
    );
    const { results, warnings } = await searchTavilyJobs(query({ provider: "tavily" }), "key", "");
    expect(results.map((r) => r.postedAt)).toEqual([recent.toISOString().slice(0, 10)]);
    expect(warnings).toEqual([expect.stringContaining("parse timed out")]);
  });
});
