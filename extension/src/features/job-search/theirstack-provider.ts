import type { JobGrade, JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { formatSalaryRange } from "@/lib/salary";
import { countryNameToIso2 } from "@/lib/country-codes";
import { dropStalePostings } from "./freshness";
import { isKnownResult } from "./merge-sources";
import { excludesAgencies, jobsuchePlace } from "./jobsuche-provider";
import { offlineNegativeTerms } from "./negative";
import { tavilyCountry } from "./tavily-provider";
import { searchTerms } from "./terms";

/**
 * TheirStack Jobs API (https://theirstack.com/en/docs/api-reference, OpenAPI read 2026-11-24) — jobs
 * from company career sites, ATSs and job boards, with the user's own key. Not live-tested: no key
 * was available (see `docs/theirstack-loopcv.md`); written against the OpenAPI schema and checked
 * with recorded-shape fixtures.
 *
 *   - `POST https://api.theirstack.com/v1/jobs/search`, `Authorization: Bearer <key>`, JSON body of
 *     filters. One of the `posted_at_*` filters is mandatory.
 *   - **Billing: 1 API credit per job returned.** Free plan: 200 API credits a month, at most 25
 *     results a page, 10 requests a minute / 50 an hour / 400 a day. Paid: from $19 for 1,500 credits.
 *     A `limit` the balance can't cover answers 402 without charging.
 *   - CORS answers any origin (the preflight reflects `chrome-extension://…`), so the extension needs
 *     no host permission for it.
 *
 * Spending as little as possible — every filter that drops what the agent would reject anyway is
 * set, because each returned job costs a credit:
 *   - one request per search (all terms in `job_title_or`), `limit` ≤ `PAGE_LIMIT`, newest first;
 *   - only fresh postings (`posted_at_max_age_days` = `MAX_AGE_DAYS`) that are still open;
 *   - only jobs with an employer/ATS link (`property_exists_or: ["final_url"]`) and not applied to
 *     inside a job board (`easy_apply_or_null: false`) — a LinkedIn/Indeed-only posting is rejected
 *     by the agent's job-board rule, so paying for it is waste;
 *   - the country (and the city, unless remote only), seniority from the grades, direct employers
 *     only when "what I don't want" says no agencies, the offline negative terms as `job_title_not`;
 *   - never the same job twice: `job_id_not` with every TheirStack id seen before (kept in
 *     `chrome.storage.local`, the last `MAX_SEEN_IDS`), plus the ones on screen;
 *   - a daily budget (`DAILY_CREDIT_BUDGET`): once today's results reach it, TheirStack is skipped
 *     with a warning until tomorrow (UTC).
 */

export const THEIRSTACK_URL = "https://api.theirstack.com/v1/jobs/search";
/** Results per request (the free plan allows 25). */
export const PAGE_LIMIT = 10;
/** Credits (= jobs returned) per UTC day, across all searches. */
export const DAILY_CREDIT_BUDGET = 25;
/** Postings older than this aren't asked for. */
export const MAX_AGE_DAYS = 14;
/** The autopilot pages on; TheirStack is asked on the first pages of a cycle only. */
export const THEIRSTACK_MAX_PAGE = 3;
const MAX_TERMS = 8;
const MAX_SEEN_IDS = 2000;
const TIMEOUT_MS = 20_000;
const STATE_KEY = "theirstackState";

export interface TheirStackJob {
  id: number;
  job_title: string;
  url?: string | null;
  final_url?: string | null;
  source_url?: string | null;
  date_posted?: string | null;
  discovered_at?: string | null;
  company?: string | null;
  company_object?: { name?: string | null; domain?: string | null } | null;
  company_domain?: string | null;
  location?: string | null;
  short_location?: string | null;
  long_location?: string | null;
  country?: string | null;
  country_code?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
  salary_string?: string | null;
  min_annual_salary?: number | null;
  max_annual_salary?: number | null;
  salary_currency?: string | null;
  description?: string | null;
  easy_apply?: boolean | null;
  closed_at?: string | null;
}

export interface TheirStackResponse {
  metadata?: { total_results?: number | null };
  data?: TheirStackJob[];
}

/** What's kept between searches (global, like the key): the ids paid for already and today's spend. */
interface TheirStackState {
  seen: number[];
  day: string;
  credits: number;
}

const SENIORITY: Record<JobGrade, string[]> = {
  student: ["junior"],
  junior: ["junior"],
  middle: ["mid_level"],
  senior: ["senior"],
  lead: ["staff", "senior"],
};

/** The ISO2 country of a search's place, or of the profile when the place names none. "" = unknown. */
export function searchCountryCode(where: string, profileCountry = ""): string {
  const named = tavilyCountry(where);
  const fromPlace = named ? countryNameToIso2(named) : countryNameToIso2(where.split(",").pop()?.trim() ?? "");
  return (fromPlace || countryNameToIso2(profileCountry) || "").toUpperCase();
}

/** "München"/"Munich" and the like: a city pattern that matches either spelling. */
const CITY_ALIASES: [RegExp, string][] = [
  [/^(münchen|munich)$/i, "münchen|munich"],
  [/^(köln|cologne)$/i, "köln|cologne"],
  [/^(nürnberg|nuremberg)$/i, "nürnberg|nuremberg"],
  [/^(hannover|hanover)$/i, "hannover|hanover"],
  [/^(wien|vienna)$/i, "wien|vienna"],
  [/^(zürich|zurich)$/i, "zürich|zurich"],
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cityPattern(where: string): string {
  const city = jobsuchePlace(where);
  // A country alone ("Netherlands") has no city to match.
  if (!city || countryNameToIso2(city)) return "";
  const alias = CITY_ALIASES.find(([re]) => re.test(city));
  return alias ? alias[1] : escapeRegex(city.toLowerCase());
}

export function buildTheirStackBody(
  query: JobSearchQuery,
  options: { countryCode: string; limit: number; excludeIds: number[] },
): Record<string, unknown> {
  const terms = searchTerms(query).slice(0, MAX_TERMS);
  const seniority = [...new Set((query.grades ?? []).flatMap((g) => SENIORITY[g] ?? []))];
  const city = query.remoteOnly ? "" : cityPattern(query.where);
  const negative = offlineNegativeTerms(query.negative ?? "").filter((t) => /^[\p{L}\p{N} +#.-]+$/u.test(t));
  return {
    ...(terms.length ? { job_title_or: terms } : {}),
    posted_at_max_age_days: MAX_AGE_DAYS,
    is_closed: false,
    property_exists_or: ["final_url"],
    easy_apply_or_null: false,
    ...(options.countryCode ? { job_country_code_or: [options.countryCode] } : {}),
    ...(city ? { job_location_pattern_or: [city] } : {}),
    ...(query.remoteOnly ? { workplace_types_or: ["remote"] } : {}),
    ...(seniority.length ? { job_seniority_or: seniority } : {}),
    ...(excludesAgencies(query.negative) ? { company_type: "direct_employer" } : {}),
    ...(negative.length ? { job_title_not: negative } : {}),
    ...(options.excludeIds.length ? { job_id_not: options.excludeIds } : {}),
    order_by: [{ field: "date_posted", desc: true }],
    include_total_results: false,
    limit: options.limit,
    page: 0,
  };
}

function httpUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function salaryOf(job: TheirStackJob): string {
  if (job.salary_string?.trim()) return job.salary_string.trim();
  const low = job.min_annual_salary ?? job.max_annual_salary;
  const high = job.max_annual_salary ?? job.min_annual_salary;
  if (!low && !high) return "";
  const range = formatSalaryRange({ low: Math.round(low ?? 0), high: Math.round(high ?? 0) });
  return job.salary_currency ? `${range} ${job.salary_currency}` : range;
}

/** One TheirStack job as a search result: the employer's career-page/ATS link (`final_url`) first. */
export function mapTheirStackJob(job: TheirStackJob): JobSearchResult {
  const final = httpUrl(job.final_url);
  const listing = httpUrl(job.url) || httpUrl(job.source_url);
  const url = final || listing;
  const description = (job.description ?? "").replace(/[#*_`>]+/g, " ").replace(/\s+/g, " ").trim();
  return {
    title: (job.job_title ?? "").trim(),
    company: (job.company_object?.name ?? job.company ?? "").trim(),
    location: (job.short_location ?? job.location ?? job.country ?? "").trim() || (job.remote ? "Remote" : ""),
    url,
    salary: salaryOf(job),
    snippet: description.slice(0, 300),
    postedAt: job.date_posted ?? "",
    source: "theirstack",
    sourceIds: { theirstack: String(job.id) },
    ...(final && listing && listing !== final ? { boardUrl: listing } : {}),
    ...(!final ? { boardOnly: true } : {}),
  };
}

function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function loadState(): Promise<TheirStackState> {
  try {
    const raw = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as Partial<TheirStackState> | undefined;
    return { seen: Array.isArray(raw?.seen) ? raw.seen.filter((n) => typeof n === "number") : [], day: raw?.day ?? "", credits: raw?.credits ?? 0 };
  } catch {
    return { seen: [], day: "", credits: 0 };
  }
}

async function saveState(state: TheirStackState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: { ...state, seen: state.seen.slice(-MAX_SEEN_IDS) } }).catch(() => {});
}

/** TheirStack ids of results already shown (a merged result keeps its TheirStack id in `sourceIds`). */
function idsOf(results: JobSearchResult[] = []): number[] {
  return results.map((r) => Number(r.sourceIds?.theirstack)).filter((n) => Number.isInteger(n) && n > 0);
}

export interface TheirStackOutcome {
  results: JobSearchResult[];
  warnings: string[];
  /** Credits this search spent (= jobs returned). */
  credits: number;
}

/**
 * One request, within today's budget, for jobs not seen before. Errors say what TheirStack said
 * (401 bad key, 402 out of credits, 429 rate limit) and are thrown; the caller turns them into a warning.
 */
export async function searchTheirStackJobs(
  query: JobSearchQuery,
  apiKey: string,
  options: { profileCountry?: string; exclude?: JobSearchResult[]; signal?: AbortSignal; now?: Date } = {},
): Promise<TheirStackOutcome> {
  const now = options.now ?? new Date();
  const state = await loadState();
  if (state.day !== todayUtc(now)) Object.assign(state, { day: todayUtc(now), credits: 0 });
  const left = DAILY_CREDIT_BUDGET - state.credits;
  if (left <= 0) return { results: [], credits: 0, warnings: [`TheirStack skipped: today's budget of ${DAILY_CREDIT_BUDGET} credits is used up (it resets at 00:00 UTC).`] };
  const countryCode = searchCountryCode(query.where, options.profileCountry);
  if (!countryCode && !query.remoteOnly) return { results: [], credits: 0, warnings: ["TheirStack skipped: set a country or city in the location, so it doesn't pay for jobs elsewhere."] };

  const excludeIds = [...new Set([...state.seen, ...idsOf(options.exclude)])].slice(-MAX_SEEN_IDS);
  const body = buildTheirStackBody(query, { countryCode, limit: Math.min(PAGE_LIMIT, left), excludeIds });
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(THEIRSTACK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (err) {
    if (timeout.aborted) throw new Error(`TheirStack timed out after ${TIMEOUT_MS / 1000} s`);
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint = res.status === 401 ? " (check the API key)" : res.status === 402 ? " (out of API credits)" : res.status === 429 ? " (rate limit — the free plan allows 10 requests a minute)" : "";
    throw new Error(`TheirStack ${res.status}${hint}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const data = ((await res.json()) as TheirStackResponse).data ?? [];
  state.credits += data.length;
  state.seen = [...new Set([...state.seen, ...data.map((j) => j.id).filter((n) => Number.isInteger(n))])];
  await saveState(state);
  const results = dropStalePostings(data.map(mapTheirStackJob).filter((r) => r.url && r.title), now).filter((r) => !isKnownResult(r, options.exclude ?? []));
  return { results, warnings: [], credits: data.length };
}
