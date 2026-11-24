import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import {
  buildJobsucheSearchUrl,
  excludesAgencies,
  externalUrl,
  isGermanSearch,
  jobsucheBoardUrl,
  jobsucheDetailsUrl,
  jobsuchePlace,
  mapJobsucheListing,
  searchJobsucheJobs,
  type JobsucheDetails,
  type JobsucheSearchResponse,
} from "@/features/job-search/jobsuche-provider";
import { mergeSourceResults, postingIdentity } from "@/features/job-search/merge-sources";
import { resultSources, sourceLabel } from "@/features/job-search/sources";
import search from "./fixtures/jobsuche/search-muenchen.json";
import detailsByRef from "./fixtures/jobsuche/details-muenchen.json";

const SEARCH = search as JobsucheSearchResponse;
const DETAILS = detailsByRef as Record<string, JobsucheDetails>;
const listing = (refnr: string) => SEARCH.ergebnisliste!.find((l) => l.referenznummer === refnr)!;

function query(extra: Partial<JobSearchQuery> = {}): JobSearchQuery {
  return { provider: "jobsuche", what: "Softwareentwickler", where: "München", ...extra };
}

describe("Jobsuche request", () => {
  it("searches v6 with the city, a radius, jobs only and the freshness window", () => {
    const url = new URL(buildJobsucheSearchUrl("Softwareentwickler", query(), 2));
    expect(url.origin + url.pathname).toBe("https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      was: "Softwareentwickler",
      wo: "München",
      umkreis: "30",
      angebotsart: "1",
      veroeffentlichtseit: "30",
      page: "2",
      size: "15",
    });
  });

  it("searches all of Germany for a country-wide place, home office for remote only, and leaves agencies out when asked", () => {
    const url = new URL(buildJobsucheSearchUrl("Backend", query({ where: "Germany", remoteOnly: true, negative: "no crypto, keine Zeitarbeit" }), 1));
    expect(url.searchParams.has("wo")).toBe(false);
    expect(url.searchParams.has("umkreis")).toBe(false);
    expect(url.searchParams.get("arbeitszeit")).toBe("ho");
    expect(url.searchParams.get("zeitarbeit")).toBe("false");
    expect(url.searchParams.get("pav")).toBe("false");
  });

  it("takes the city out of a longer place", () => {
    expect(jobsuchePlace("Berlin, Germany")).toBe("Berlin");
    expect(jobsuchePlace("Remote, Deutschland")).toBe("");
    expect(jobsuchePlace("Frankfurt am Main")).toBe("Frankfurt am Main");
    expect(excludesAgencies("no agencies")).toBe(true);
    expect(excludesAgencies("no crypto")).toBe(false);
  });

  it("encodes the refnr as base64 for details and twice-encodes a slash for the BA page", () => {
    expect(jobsucheDetailsUrl("10001-1002716922-S")).toBe("https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/MTAwMDEtMTAwMjcxNjkyMi1T");
    expect(jobsucheBoardUrl("12117-YF-48852-YF-S")).toBe("https://www.arbeitsagentur.de/jobsuche/jobdetail/12117-YF-48852-YF-S");
    expect(jobsucheBoardUrl("13319-898750/1_5315CS-S")).toBe("https://www.arbeitsagentur.de/jobsuche/jobdetail/13319-898750%252F1_5315CS-S");
  });
});

describe("isGermanSearch", () => {
  it("knows Germany by name, by city, and by the profile when the place says nothing", () => {
    expect(isGermanSearch("Germany")).toBe(true);
    expect(isGermanSearch("Köln")).toBe(true);
    expect(isGermanSearch("Heidelberg")).toBe(true);
    expect(isGermanSearch("Munich, Bavaria")).toBe(true);
    expect(isGermanSearch("", "Germany")).toBe(true);
    expect(isGermanSearch("Remote", "Germany")).toBe(true);
  });

  it("skips other countries, whatever the profile says", () => {
    expect(isGermanSearch("Vienna", "Germany")).toBe(false);
    expect(isGermanSearch("Netherlands", "Germany")).toBe(false);
    expect(isGermanSearch("Amsterdam", "Germany")).toBe(false);
    expect(isGermanSearch("", "France")).toBe(false);
    expect(isGermanSearch("")).toBe(false);
  });
});

describe("mapping a listing", () => {
  it("uses the external link from the details, keeping the BA page beside it", () => {
    const ref = "13644-246608-S";
    const r = mapJobsucheListing(listing(ref), DETAILS[ref], "Softwareentwickler");
    expect(r).toMatchObject({
      title: "Senior Softwareentwickler (m/w/d)",
      company: "Infomotion GmbH",
      url: "https://www.get-in-it.de/jobsuche/p246608?utm_source=arbeitsagentur&utm_medium=organic&utm_campaign=launch-premium",
      boardUrl: "https://www.arbeitsagentur.de/jobsuche/jobdetail/13644-246608-S",
      source: "jobsuche",
      tag: "Softwareentwickler",
    });
    expect(r.boardOnly).toBeUndefined();
    expect(r.snippet.length).toBeGreaterThan(50);
    expect(r.snippet.length).toBeLessThanOrEqual(300);
    expect(r.postedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.location).toMatch(/München|Munich|\d{5}/);
  });

  it("takes externeURL straight from the search listing when it has one", () => {
    const ref = "12117-YF-48852-YF-S";
    expect(listing(ref).externeURL).toBeTruthy();
    expect(mapJobsucheListing(listing(ref)).url).toMatch(/^https:\/\/www\.yourfirm\.de\/job\/detail\/YF-48852\//);
  });

  it("keeps a posting that lives only on arbeitsagentur.de, tagged board-only", () => {
    const ref = "10001-1001883453-S";
    const r = mapJobsucheListing(listing(ref), DETAILS[ref]);
    expect(r.url).toBe("https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1001883453-S");
    expect(r.boardOnly).toBe(true);
    expect(r.boardUrl).toBeUndefined();
    expect(r.company.trim()).toBe(r.company);
  });

  it("links a slash refnr to a BA page that works", () => {
    const ref = "13319-898750/1_5315CS-S";
    expect(mapJobsucheListing(listing(ref), DETAILS[ref]).url).toBe("https://www.arbeitsagentur.de/jobsuche/jobdetail/13319-898750%252F1_5315CS-S");
  });

  it("formats a salary range and accepts either spelling of the external link", () => {
    expect(mapJobsucheListing({ referenznummer: "x", stellenangebotsTitel: "A", firma: "B", gehaltsspanneVon: 40000, gehaltsspanneBis: 65000 }).salary).toMatch(/40.*65/);
    expect(externalUrl({ externeUrl: "jobs.example.com/1" })).toBe("https://jobs.example.com/1");
    expect(externalUrl({ externeURL: "javascript:alert(1)" })).toBe("");
    expect(externalUrl(null)).toBe("");
  });
});

describe("searchJobsucheJobs (recorded responses, no network)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T08:00:00Z"));
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("jobboerse-jobsuche");
      if (url.includes("/pc/v6/jobs")) return new Response(JSON.stringify(SEARCH), { status: 200 });
      const b64 = decodeURIComponent(url.split("/jobdetails/")[1]);
      const details = DETAILS[atob(b64)];
      return details ? new Response(JSON.stringify(details), { status: 200 }) : new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("maps every listing, fetching details once per posting", async () => {
    const { results, warnings } = await searchJobsucheJobs(query());
    expect(warnings).toEqual([]);
    expect(results).toHaveLength(5);
    expect(results.filter((r) => r.boardOnly)).toHaveLength(3);
    expect(results.every((r) => r.source === "jobsuche")).toBe(true);
    const detailCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/jobdetails/"));
    expect(detailCalls).toHaveLength(5);
  });

  it("doesn't fetch details for postings already shown", async () => {
    const known = mapJobsucheListing(listing("10001-1001883453-S"));
    const { results } = await searchJobsucheJobs(query(), 1, { exclude: [known] });
    expect(results.map((r) => r.url)).not.toContain(known.url);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/jobdetails/"))).toHaveLength(4);
  });

  it("dedupes the same posting across terms", async () => {
    const { results } = await searchJobsucheJobs(query({ terms: ["Softwareentwickler", "Software Engineer"] }));
    expect(results).toHaveLength(5);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/pc/v6/jobs"))).toHaveLength(2);
  });

  it("is quiet about an empty result, warns about one failed term, and throws when every term fails", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ maxErgebnisse: 0 }), { status: 200 }));
    expect((await searchJobsucheJobs(query())).results).toEqual([]);

    fetchMock.mockImplementationOnce(async () => new Response("No match found for request", { status: 403 }));
    const partial = await searchJobsucheJobs(query({ terms: ["a", "b"] }));
    expect(partial.warnings).toHaveLength(1);
    expect(partial.warnings[0]).toContain("403");
    expect(partial.results).toHaveLength(5);

    fetchMock.mockImplementation(async () => new Response("down", { status: 503 }));
    await expect(searchJobsucheJobs(query())).rejects.toThrow("Arbeitsagentur 503");
  });

  it("drops postings older than the freshness window", async () => {
    vi.setSystemTime(new Date("2027-03-01T08:00:00Z"));
    expect((await searchJobsucheJobs(query())).results).toEqual([]);
  });
});

describe("cross-source dedupe", () => {
  const ba = (ref: string) => mapJobsucheListing(listing(ref), DETAILS[ref]);
  const tavily = (extra: Partial<JobSearchResult>): JobSearchResult => ({
    title: "",
    company: "",
    location: "",
    url: "",
    salary: "",
    snippet: "",
    source: "tavily",
    ...extra,
  });

  it("shows a posting Tavily and the Arbeitsagentur both found once, with both tags", () => {
    const viaBa = ba("13644-246608-S");
    // Tavily found the same external page, without the tracking parameters.
    const viaTavily = tavily({ title: "Senior Softwareentwickler", company: "Infomotion", url: "https://get-in-it.de/jobsuche/p246608" });
    const merged = mergeSourceResults([viaTavily], [viaBa]);
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe(viaTavily.url);
    expect(resultSources(merged[0])).toEqual(["tavily", "jobsuche"]);
    expect(merged[0].boardUrl).toBe(viaBa.boardUrl);
    expect(merged[0].postedAt).toBe(viaBa.postedAt);
  });

  it("matches by company and title when the links differ, preferring the link the agent can apply on", () => {
    const viaBa = ba("10001-1001883453-S");
    expect(viaBa.boardOnly).toBe(true);
    const ats = tavily({ title: `${viaBa.title} `, company: `${viaBa.company} GmbH`, url: "https://jobs.personio.de/zollsoft/123" });
    const merged = mergeSourceResults([viaBa], [ats]);
    expect(merged).toHaveLength(1);
    expect(merged[0].url).toBe(ats.url);
    expect(merged[0].boardOnly).toBeUndefined();
    expect(merged[0].boardUrl).toBe(viaBa.url);
    expect(resultSources(merged[0])).toEqual(["tavily", "jobsuche"]);
  });

  it("keeps different postings apart and a single source's list as it was", () => {
    const list = SEARCH.ergebnisliste!.map((l) => mapJobsucheListing(l, DETAILS[l.referenznummer]));
    expect(mergeSourceResults(list)).toEqual(list);
    expect(mergeSourceResults([tavily({ title: "A", company: "X", url: "https://a/1" })], [tavily({ title: "B", company: "X", url: "https://a/2", source: "adzuna" })])).toHaveLength(2);
  });

  it("normalizes company and title for the match", () => {
    expect(postingIdentity("FERCHAU GmbH Niederlassung München Mobility", "Softwareentwickler C# (m/w/d)")).toBe(postingIdentity("Ferchau München Mobility", "Softwareentwickler C#"));
    expect(postingIdentity("", "x")).toBe("");
  });

  it("labels every source, LinkedIn included, and an unknown one as itself", () => {
    expect(sourceLabel("jobsuche")).toBe("Arbeitsagentur");
    expect(sourceLabel("linkedin")).toBe("LinkedIn");
    expect(sourceLabel("stepstone")).toBe("stepstone");
  });
});
