import type { JobSearchResult } from "@/types/job-search";
import { ATS_DOMAINS } from "@/features/job-search/freshness";
import { TAVILY_ATS_HOSTS, fetchTavily, type TavilyResult } from "@/features/job-search/tavily-provider";

/**
 * A job collected on LinkedIn is a lead, not a place to apply: FillerAgent applies on the
 * employer's own career site / ATS and refuses job boards (its `criteria.blockedHosts`), and it must
 * never open LinkedIn. So the same posting is looked up on the open web by title + company —
 * through Tavily with the user's own key, never through LinkedIn — and the user picks the match
 * before anything goes to the agent.
 */

/** Hosts that list other companies' jobs — never the employer's own posting. Mirrors FillerAgent's default `blockedHosts`. */
export const JOB_BOARD_HOSTS = [
  "linkedin.com",
  "xing.com",
  "indeed.com",
  "indeed.de",
  "stepstone.de",
  "glassdoor.com",
  "glassdoor.de",
  "monster.de",
  "monster.com",
  "arbeitsagentur.de",
  "kununu.com",
  "jooble.org",
  "ziprecruiter.com",
  "talent.com",
  "jobware.de",
  "stellenanzeigen.de",
  "wellfound.com",
  "builtin.com",
  "simplyhired.com",
  "careerjet.de",
];

/** Boards with a site per country (`de.indeed.com`, `indeed.co.uk`, `glassdoor.ch`). */
const BOARD_ANY_TLD_RE = /(?:^|\.)(?:linkedin|indeed|glassdoor|monster|stepstone|xing)\.[a-z.]+$/;

export function isJobBoardUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BOARD_ANY_TLD_RE.test(host) || JOB_BOARD_HOSTS.some((board) => host === board || host.endsWith(`.${board}`));
  } catch {
    return true;
  }
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}+#]+/u)
    .filter((word) => word.length > 1);
}

/** Legal-form and filler words that say nothing about which company it is. */
const COMPANY_NOISE = new Set(["gmbh", "ag", "se", "kg", "co", "inc", "ltd", "llc", "plc", "bv", "sa", "sas", "ug", "group", "gruppe", "holding", "the", "und", "and"]);
const TITLE_NOISE = new Set(["m", "w", "d", "f", "x", "mwd", "all", "genders", "gn", "in", "the", "and", "und", "for", "of"]);

/**
 * How well a web hit matches the LinkedIn job, 0..1: the share of the title's words found in the
 * hit's title, times whether the company is named in its title, URL or text. 0 for a job board.
 */
export function scoreEmployerHit(hit: Pick<TavilyResult, "title" | "url" | "content">, job: { title: string; company: string }): number {
  if (isJobBoardUrl(hit.url)) return 0;
  const titleWords = words(job.title).filter((word) => !TITLE_NOISE.has(word));
  const companyWords = words(job.company).filter((word) => !COMPANY_NOISE.has(word));
  if (titleWords.length === 0 || companyWords.length === 0) return 0;
  const hitTitle = new Set(words(hit.title));
  const titleShare = titleWords.filter((word) => hitTitle.has(word)).length / titleWords.length;
  const haystack = `${hit.title} ${hit.url} ${hit.content ?? ""}`.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const squashed = haystack.replace(/[^\p{L}\p{N}]+/gu, "");
  const companyNamed = companyWords.every((word) => haystack.includes(word)) || squashed.includes(companyWords.join(""));
  return companyNamed ? titleShare : 0;
}

/** A hit counts as the same posting from this score on. */
export const MIN_EMPLOYER_SCORE = 0.6;

export function rankEmployerHits(hits: TavilyResult[], job: { title: string; company: string; location: string }, max = 3): JobSearchResult[] {
  const seen = new Set<string>();
  return hits
    .map((hit) => ({ hit, score: scoreEmployerHit(hit, job) }))
    .filter(({ hit, score }) => {
      const key = hit.url.replace(/[?#].*$/, "").replace(/\/$/, "");
      if (score < MIN_EMPLOYER_SCORE || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ hit }) => ({
      title: hit.title,
      company: job.company,
      location: job.location,
      url: hit.url,
      salary: "",
      snippet: (hit.content ?? "").slice(0, 240),
      // The LinkedIn lead it belongs to first, then the web search that found the employer's page.
      source: "linkedin" as const,
      sources: ["linkedin" as const, "tavily" as const],
    }));
}

/** The employer's own posting for a LinkedIn job: up to three candidates, best first, none from a job board. */
export async function findEmployerPosting(job: { title: string; company: string; location: string }, tavilyApiKey: string, signal?: AbortSignal): Promise<JobSearchResult[]> {
  if (!job.title.trim() || !job.company.trim()) throw new Error("This job has no title or company yet — add it again from LinkedIn once its card has loaded.");
  if (!tavilyApiKey) throw new Error("Finding the employer's posting uses Tavily — add your Tavily API key in Settings first.");
  const query = `"${job.title.trim()}" "${job.company.trim()}" ${job.location.split(/[,(]/)[0].trim()} job`.slice(0, 350);
  const data = await fetchTavily(
    {
      api_key: tavilyApiKey,
      query,
      search_depth: "basic",
      max_results: 10,
      include_answer: false,
      // ATS and career pages first, without losing an employer's own site that isn't on the list.
      include_domains: [...new Set([...ATS_DOMAINS, ...TAVILY_ATS_HOSTS])],
      include_domains_mode: "prefer",
      exclude_domains: JOB_BOARD_HOSTS,
    },
    signal,
  );
  return rankEmployerHits(data.results ?? [], job);
}
