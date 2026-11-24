import type { JobGrade, JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { dropStalePostings } from "./freshness";
import { isKnownResult } from "./merge-sources";
import { jobsuchePlace } from "./jobsuche-provider";
import { tavilyCountry } from "./tavily-provider";
import { searchTerms } from "./terms";
import { countryNameToIso2 } from "@/lib/country-codes";

/**
 * LoopCV B2B API (https://api-docs.loopcv.com, read 2026-11-24) with the user's own key. Not
 * live-tested: no key was available (see `docs/theirstack-loopcv.md`); written against the documented
 * request/response examples and checked with fixtures in that shape.
 *
 * LoopCV doesn't search on request. A *Loop* is a saved search (title, "city, country", type,
 * level) that LoopCV runs several times a day over 30+ job boards and ATSs; its jobs are read
 * later. The `GET api.loopcv.pro/v1/jobs?keyword=…` example on the marketing page points at a host
 * that doesn't exist (NXDOMAIN on 2026-11-24); the documented API is `b2b-api.loopcv.com/connect`:
 *
 *   - `POST /loop` {title, location, type, level, keywords?, externalId?} → {loopId}
 *   - `GET /loop/{id}/matches` → the loop's jobs that pass its criteria:
 *     {_id, title, company, location, summary, url, job_type, applyLink, email, domain}
 *   - `DELETE /loop/{id}`; header `X-API-KEY` on every call. No pagination, no rate limits and no
 *     per-call pricing are documented (a free tier exists; volume pricing on request).
 *   - No CORS headers (a preflight from an extension origin gets 401 without them), so the extension
 *     asks for the optional host permission `https://b2b-api.loopcv.com/*`.
 *
 * So: one loop per search term (at most `MAX_TERMS`) and place, created on first use and remembered
 * in `chrome.storage.local`; a search reads each loop's matches. A brand-new loop has nothing yet —
 * the search says so once and the postings come with later searches (the autopilot's next cycle).
 * At most `MAX_LOOPS` loops are kept: the least recently used one is deleted at LoopCV when a new
 * one is needed, so changing searches doesn't pile loops up in the user's account. `applyLink` (the
 * employer's apply page) wins over `url` (the listing it was found on).
 */

export const LOOPCV_BASE = "https://b2b-api.loopcv.com/connect";
export const LOOPCV_ORIGIN = "https://b2b-api.loopcv.com/*";
const MAX_TERMS = 2;
const MAX_LOOPS = 6;
const TIMEOUT_MS = 20_000;
const STATE_KEY = "loopcvLoops";

export interface LoopCvJob {
  _id?: string;
  title?: string;
  company?: string;
  location?: string;
  summary?: string;
  url?: string;
  applyLink?: string;
  platform?: string;
  createdAtDate?: string;
  job_type?: string;
  level?: string;
  email?: string;
  domain?: string;
}

interface LoopRecord {
  loopId: string;
  createdAt: string;
  usedAt: string;
}

type LoopState = Record<string, LoopRecord>;

export type LoopLevel = "Junior" | "Associate" | "Senior";

/** LoopCV knows three levels; the grades map onto them (none picked: "Associate", the middle one). */
export function loopLevel(grades: JobGrade[] | undefined): LoopLevel {
  const g = grades ?? [];
  if (g.includes("senior") || g.includes("lead")) return "Senior";
  if (g.includes("middle")) return "Associate";
  if (g.includes("junior") || g.includes("student")) return "Junior";
  return "Associate";
}

function titleCase(text: string): string {
  return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * The loop's location in LoopCV's "city, country" format: "Berlin, Germany" as typed, a city alone
 * gets the country it's in (or the profile's), a country alone stays as it is.
 */
export function loopLocation(where: string, profileCountry = ""): string {
  const parts = where.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
  const city = jobsuchePlace(where);
  // A country alone ("Netherlands") is the location as it is.
  if (city && countryNameToIso2(city)) return titleCase(city);
  const country = tavilyCountry(where) ? titleCase(tavilyCountry(where)) : profileCountry.trim();
  if (!city) return country;
  return country ? `${city}, ${country}` : city;
}

function loopKey(title: string, location: string, level: string): string {
  return [title, location, level].map((s) => s.trim().toLowerCase()).join("|");
}

async function loadLoops(): Promise<LoopState> {
  try {
    return ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as LoopState | undefined) ?? {};
  } catch {
    return {};
  }
}

async function saveLoops(state: LoopState): Promise<void> {
  await chrome.storage.local.set({ [STATE_KEY]: state }).catch(() => {});
}

async function call<T>(method: string, path: string, apiKey: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${LOOPCV_BASE}${path}`, {
      method,
      headers: { "X-API-KEY": apiKey, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if (timeout.aborted) throw new Error(`LoopCV timed out after ${TIMEOUT_MS / 1000} s`);
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LoopCV ${res.status}${res.status === 401 ? " (check the API key)" : ""}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

function httpUrl(raw: string | undefined): string {
  if (!raw) return "";
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const JOB_BOARD_HOSTS = /(?:^|\.)(?:linkedin\.com|indeed\.[a-z.]+|glassdoor\.[a-z.]+|stepstone\.[a-z.]+|xing\.com|monster\.[a-z.]+|ziprecruiter\.com|jooble\.org|careerjet\.[a-z.]+|simplyhired\.com|totaljobs\.com|reed\.co\.uk|adzuna\.[a-z.]+)$/i;

/** One LoopCV job as a search result: the employer's apply link first, the listing it was found on beside it. */
export function mapLoopCvJob(job: LoopCvJob, tag?: string): JobSearchResult {
  const apply = httpUrl(job.applyLink);
  const listing = httpUrl(job.url);
  const url = apply || listing;
  let boardOnly = false;
  try {
    boardOnly = !apply && JOB_BOARD_HOSTS.test(new URL(url).hostname);
  } catch {
    /* no usable link — dropped by the caller */
  }
  return {
    title: (job.title ?? "").trim(),
    company: (job.company ?? "").trim(),
    location: (job.location ?? "").trim(),
    url,
    salary: "",
    snippet: (job.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
    postedAt: job.createdAtDate ?? "",
    source: "loopcv",
    ...(job._id ? { sourceIds: { loopcv: job._id } } : {}),
    ...(apply && listing && apply !== listing ? { boardUrl: listing } : {}),
    ...(boardOnly ? { boardOnly: true } : {}),
    ...(tag ? { tag } : {}),
  };
}

/** The loop for this title/place/level: the remembered one, or a new one (dropping the least recently used beyond `MAX_LOOPS`). */
async function ensureLoop(
  state: LoopState,
  spec: { title: string; location: string; level: LoopLevel },
  apiKey: string,
  now: Date,
  signal?: AbortSignal,
): Promise<{ loopId: string; created: boolean }> {
  const key = loopKey(spec.title, spec.location, spec.level);
  const known = state[key];
  if (known) {
    known.usedAt = now.toISOString();
    return { loopId: known.loopId, created: false };
  }
  const { loopId } = await call<{ loopId: string }>(
    "POST",
    "/loop",
    apiKey,
    { title: spec.title, location: spec.location, type: "Full-time", level: spec.level, externalId: `filler:${key}`.slice(0, 120) },
    signal,
  );
  if (!loopId) throw new Error("LoopCV didn't return a loop id");
  state[key] = { loopId, createdAt: now.toISOString(), usedAt: now.toISOString() };
  const stale = Object.entries(state)
    .sort(([, a], [, b]) => a.usedAt.localeCompare(b.usedAt))
    .slice(0, Math.max(0, Object.keys(state).length - MAX_LOOPS));
  for (const [oldKey, old] of stale) {
    await call("DELETE", `/loop/${encodeURIComponent(old.loopId)}`, apiKey, undefined, signal).catch(() => undefined);
    delete state[oldKey];
  }
  return { loopId, created: true };
}

export interface LoopCvOutcome {
  results: JobSearchResult[];
  warnings: string[];
}

/** Reads each term's loop (creating it on first use). Page 2+ has nothing new: a loop has no pages. */
export async function searchLoopCvJobs(
  query: JobSearchQuery,
  apiKey: string,
  options: { page?: number; profileCountry?: string; exclude?: JobSearchResult[]; signal?: AbortSignal; now?: Date } = {},
): Promise<LoopCvOutcome> {
  if ((options.page ?? 1) > 1) return { results: [], warnings: [] };
  const now = options.now ?? new Date();
  const location = loopLocation(query.where, options.profileCountry);
  if (!location) return { results: [], warnings: ["LoopCV skipped: it needs a location (city, country)."] };
  const terms = searchTerms(query).slice(0, MAX_TERMS);
  if (terms.length === 0) return { results: [], warnings: [] };
  const level = loopLevel(query.grades);
  const state = await loadLoops();
  const results: JobSearchResult[] = [];
  const warnings: string[] = [];
  const created: string[] = [];
  let failed = 0;
  let firstError: unknown = null;
  try {
    for (const term of terms) {
      if (options.signal?.aborted) break;
      try {
        const loop = await ensureLoop(state, { title: term, location, level }, apiKey, now, options.signal);
        if (loop.created) created.push(term);
        const jobs = (await call<LoopCvJob[] | null>("GET", `/loop/${encodeURIComponent(loop.loopId)}/matches`, apiKey, undefined, options.signal)) ?? [];
        const batch = jobs.map((j) => mapLoopCvJob(j, term)).filter((r) => r.url && r.title && !isKnownResult(r, [...(options.exclude ?? []), ...results]));
        results.push(...dropStalePostings(batch, now));
      } catch (err) {
        failed++;
        firstError ??= err;
        warnings.push(`LoopCV "${term}" — ${err instanceof Error ? err.message : "search failed"}`);
      }
    }
  } finally {
    await saveLoops(state);
  }
  if (failed === terms.length && firstError) throw firstError;
  if (created.length > 0 && results.length === 0) {
    warnings.push(`LoopCV: set up a search for ${created.map((t) => `"${t}"`).join(", ")} in ${location}. LoopCV collects jobs for it several times a day, so its postings come with the next searches.`);
  }
  return { results, warnings };
}
