import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { formatSalaryRange } from "@/lib/salary";
import { countryNameToIso2 } from "@/lib/country-codes";
import { dropStalePostings, MAX_POSTING_AGE_DAYS } from "./freshness";
import { isKnownResult } from "./merge-sources";
import { parseNegativeTerms } from "./negative";
import { TAVILY_CITIES, tavilyCountry } from "./tavily-provider";
import { searchTerms } from "./terms";

/**
 * The Bundesagentur für Arbeit's job board ("Jobsuche", https://jobsuche.api.bund.dev/) — the
 * biggest job database in Germany, and Germany only. A literal keyword search like Adzuna: the
 * listings come back structured, no AI parse pass. Verified live on 2026-11-24 (see
 * `docs/jobsuche.md`):
 *
 *   - search: `GET /pc/v6/jobs` (`/pc/v4/jobs` answers 403 now) with `was`, `wo`, `umkreis`,
 *     `angebotsart`, `veroeffentlichtseit`, `arbeitszeit`, `zeitarbeit`, `pav`, `page`, `size`.
 *     Results are `ergebnisliste[]` keyed by `referenznummer`; there's no link to the employer there.
 *   - details: `GET /pc/v4/jobdetails/<base64(refnr)>` — the description and, when the posting came
 *     from a partner board or the employer's ATS, `externeURL` (capital URL; the docs say `externeUrl`).
 *   - header `X-API-Key: jobboerse-jobsuche` on both. No CORS for other origins, so the extension
 *     needs the host permission (`JOBSUCHE_ORIGIN`, optional, asked for in the Side Panel).
 *
 * A result's `url` is `externeURL` when the details have one — the page the agent can apply on —
 * else the posting's arbeitsagentur.de page (`boardOnly`: the BA's own postings are applied to
 * through the BA's account or by mail, which the agent can't do by itself; they're kept and tagged).
 *
 * Polite by design: a few terms, 15 results each, one request at a time with a gap, details only for
 * postings not already shown, at most `DETAIL_CONCURRENCY` at once. A term that fails is a warning;
 * every term failing is an error, like Adzuna.
 */

export const JOBSUCHE_BASE = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service";
/** The origin the extension's optional host permission covers (`chrome.permissions.request`). */
export const JOBSUCHE_ORIGIN = "https://rest.arbeitsagentur.de/*";
const API_KEY = "jobboerse-jobsuche";
const PAGE_SIZE = 15;
/** Terms searched per run; each is one search request plus details for its new postings. */
const MAX_TERMS = 3;
/** Details (the external link, the description) per run — every new posting of a full run gets them. */
const MAX_DETAILS = MAX_TERMS * PAGE_SIZE;
const DETAIL_CONCURRENCY = 3;
const REQUEST_GAP_MS = 300;
const TIMEOUT_MS = 15_000;
/** Radius around a city, km — the BA's own default is 25; a bit wider catches the suburbs. */
const RADIUS_KM = 30;
/** The autopilot pages on and on (Tavily has 13 rounds): Jobsuche stops after this page and starts over. */
export const JOBSUCHE_MAX_PAGE = 5;

export interface JobsucheListing {
  referenznummer: string;
  stellenangebotsTitel?: string;
  titel?: string;
  hauptberuf?: string;
  firma?: string;
  arbeitgeber?: string;
  stellenlokationen?: { adresse?: { ort?: string; plz?: string; region?: string; land?: string } }[];
  arbeitsort?: { ort?: string; plz?: string | number; region?: string };
  veroeffentlichungszeitraum?: { von?: string };
  datumErsteVeroeffentlichung?: string;
  aktuelleVeroeffentlichungsdatum?: string;
  verguetungsangabe?: string;
  festgehalt?: number;
  gehaltsspanneVon?: number;
  gehaltsspanneBis?: number;
  externeUrl?: string;
  externeURL?: string;
}

export interface JobsucheSearchResponse {
  ergebnisliste?: JobsucheListing[];
  maxErgebnisse?: number | string;
}

export interface JobsucheDetails extends JobsucheListing {
  stellenangebotsBeschreibung?: string;
  stellenbeschreibung?: string;
  allianzpartnerName?: string;
  istArbeitnehmerUeberlassung?: boolean;
  istPrivateArbeitsvermittlung?: boolean;
}

/** The posting's page on arbeitsagentur.de. A "/" in the refnr has to be encoded twice (`%252F`), or the site drops it. */
export function jobsucheBoardUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr).replace(/%/g, "%25")}`;
}

/** base64 of the refnr, as the details path wants it (refnrs are ASCII). */
export function jobsucheDetailsUrl(refnr: string): string {
  return `${JOBSUCHE_BASE}/pc/v4/jobdetails/${encodeURIComponent(btoa(refnr))}`;
}

/** The employer/ATS link from the details, when there is one (either spelling), else "". */
export function externalUrl(details: Pick<JobsucheDetails, "externeURL" | "externeUrl"> | null | undefined): string {
  const raw = (details?.externeURL ?? details?.externeUrl ?? "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const COUNTRY_GERMANY = /(?<!\p{L})(?:germany|deutschland|германия|bundesweit|de)(?!\p{L})/giu;
const REMOTE_WORDS = /(?<!\p{L})(?:remote|anywhere|worldwide|home\s*office|homeoffice|удал[её]нн?о?)(?!\p{L})/giu;
const GERMAN_CITIES = /(?<!\p{L})(?:köln|münchen|nürnberg|hannover|frankfurt am main|düsseldorf|bremen|heidelberg|freiburg|potsdam|kiel|lübeck|rostock|augsburg|regensburg|würzburg|ulm|darmstadt|wiesbaden|mainz|münster|bielefeld|aachen|duisburg|bochum|wuppertal|braunschweig|magdeburg|erfurt|jena|halle|chemnitz|saarbrücken|ingolstadt|wolfsburg|göttingen|osnabrück|oldenburg|kassel|paderborn|koblenz|trier|konstanz|tübingen|erlangen)(?!\p{L})/iu;

/**
 * Whether a search's place is in Germany — the only country the BA covers. "Germany"/"Deutschland",
 * a German city ("Berlin", "Köln", one of the cities the Tavily rounds walk), or — when the place
 * names no country or known city ("" / "Remote" / a small town) — the profile's country.
 */
export function isGermanSearch(where: string, profileCountry = ""): boolean {
  const country = tavilyCountry(where);
  if (country) return country === "germany";
  if (GERMAN_CITIES.test(where)) return true;
  const lower = where.toLowerCase();
  if (TAVILY_CITIES.germany.some((city) => lower.includes(city.toLowerCase()))) return true;
  for (const [name, cities] of Object.entries(TAVILY_CITIES)) {
    if (name !== "germany" && cities.some((city) => lower.includes(city.toLowerCase()))) return false;
  }
  return countryNameToIso2(profileCountry)?.toUpperCase() === "DE";
}

/** The BA's `wo`: the city part of "Berlin, Germany"; "" for the whole country (or "Remote"). */
export function jobsuchePlace(where: string): string {
  const parts = where
    .split(/[,;/|]+/)
    .map((p) => p.replace(COUNTRY_GERMANY, " ").replace(REMOTE_WORDS, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return parts[0] ?? "";
}

/** "no agencies" / "keine Zeitarbeit" in "what I don't want": the BA can leave those out at the source. */
const AGENCY_TERM = /agen(?:cy|cies|tur)|recruit|zeitarbeit|personaldienst|arbeitnehmerüberlassung|leiharbeit|vermittl|headhunt|staffing|кадров|рекрут/i;
export function excludesAgencies(negative: string | undefined): boolean {
  return parseNegativeTerms(negative ?? "").some((term) => AGENCY_TERM.test(term));
}

export function buildJobsucheSearchUrl(term: string, query: Pick<JobSearchQuery, "where" | "remoteOnly" | "negative">, page: number, size = PAGE_SIZE): string {
  const url = new URL(`${JOBSUCHE_BASE}/pc/v6/jobs`);
  if (term) url.searchParams.set("was", term);
  const place = jobsuchePlace(query.where);
  if (place) {
    url.searchParams.set("wo", place);
    url.searchParams.set("umkreis", String(RADIUS_KM));
  }
  url.searchParams.set("angebotsart", "1");
  url.searchParams.set("veroeffentlichtseit", String(MAX_POSTING_AGE_DAYS));
  if (query.remoteOnly) url.searchParams.set("arbeitszeit", "ho");
  if (excludesAgencies(query.negative)) {
    url.searchParams.set("zeitarbeit", "false");
    url.searchParams.set("pav", "false");
  }
  url.searchParams.set("page", String(Math.max(1, page)));
  url.searchParams.set("size", String(size));
  return url.toString();
}

function salaryOf(l: JobsucheListing): string {
  const low = l.gehaltsspanneVon ?? l.festgehalt;
  const high = l.gehaltsspanneBis ?? l.festgehalt;
  if (!low && !high) return "";
  const range = formatSalaryRange({ low: Math.round(low ?? high ?? 0), high: Math.round(high ?? low ?? 0) });
  return l.verguetungsangabe === "MONATSGEHALT" ? `${range} / month` : range;
}

function locationOf(l: JobsucheListing): string {
  const a = l.stellenlokationen?.[0]?.adresse;
  if (a?.ort) return a.plz ? `${a.plz} ${a.ort}` : a.ort;
  if (l.arbeitsort?.ort) return l.arbeitsort.ort;
  return a?.region ? a.region.charAt(0) + a.region.slice(1).toLowerCase() : "";
}

function clean(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** One search listing (plus its details, when fetched) as a search result. */
export function mapJobsucheListing(listing: JobsucheListing, details?: JobsucheDetails | null, tag?: string): JobSearchResult {
  const refnr = listing.referenznummer;
  const external = externalUrl(details) || externalUrl(listing);
  const board = jobsucheBoardUrl(refnr);
  const description = clean(details?.stellenangebotsBeschreibung ?? details?.stellenbeschreibung);
  return {
    title: clean(listing.stellenangebotsTitel ?? listing.titel ?? details?.stellenangebotsTitel) || clean(listing.hauptberuf),
    company: clean(listing.firma ?? listing.arbeitgeber ?? details?.firma),
    location: locationOf(listing),
    url: external || board,
    salary: salaryOf(listing),
    snippet: (description || clean(listing.hauptberuf)).slice(0, 300),
    postedAt: listing.veroeffentlichungszeitraum?.von ?? listing.aktuelleVeroeffentlichungsdatum ?? listing.datumErsteVeroeffentlichung ?? "",
    source: "jobsuche",
    ...(external ? { boardUrl: board } : { boardOnly: true }),
    ...(tag ? { tag } : {}),
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(id), resolve()), { once: true });
  });
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "X-API-Key": API_KEY, Accept: "application/json" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (err) {
    if (timeout.aborted) throw new Error(`timed out after ${TIMEOUT_MS / 1000} s`);
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Arbeitsagentur ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** Details for each listing, a few at a time; a failed one is just missing (the result keeps the BA link). */
async function fetchDetails(listings: JobsucheListing[], signal?: AbortSignal): Promise<Map<string, JobsucheDetails | null>> {
  const out = new Map<string, JobsucheDetails | null>();
  let next = 0;
  async function worker() {
    while (next < listings.length && !signal?.aborted) {
      const listing = listings[next++];
      try {
        out.set(listing.referenznummer, await getJson<JobsucheDetails>(jobsucheDetailsUrl(listing.referenznummer), signal));
      } catch {
        out.set(listing.referenznummer, null);
      }
      await sleep(REQUEST_GAP_MS, signal);
    }
  }
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, listings.length) }, worker));
  return out;
}

export interface JobsucheSearchOutcome {
  results: JobSearchResult[];
  warnings: string[];
}

/**
 * Searches each term (`query.terms` / `query.what`, at most `MAX_TERMS`) on page `page`, then
 * fetches details for the new postings — ones not in `exclude` by their arbeitsagentur.de page,
 * link or company + title. `onResults` sees each term's batch as soon as it's mapped.
 */
export async function searchJobsucheJobs(
  query: JobSearchQuery,
  page = 1,
  options: { exclude?: JobSearchResult[]; onResults?: (results: JobSearchResult[]) => void; signal?: AbortSignal } = {},
): Promise<JobsucheSearchOutcome> {
  const { exclude = [], onResults, signal } = options;
  const terms = searchTerms(query).slice(0, MAX_TERMS);
  if (terms.length === 0) terms.push("");
  const warnings: string[] = [];
  const seen = new Set<string>();
  const results: JobSearchResult[] = [];
  let failed = 0;
  let firstError: unknown = null;
  let detailBudget = MAX_DETAILS;

  for (let i = 0; i < terms.length && !signal?.aborted; i++) {
    const term = terms[i];
    try {
      const data = await getJson<JobsucheSearchResponse>(buildJobsucheSearchUrl(term, query, page), signal);
      const listings = (data.ergebnisliste ?? []).filter((l) => {
        if (!l?.referenznummer || seen.has(l.referenznummer)) return false;
        seen.add(l.referenznummer);
        return true;
      });
      // Without details, a posting already shown is still recognised by its BA page or company + title.
      const fresh = listings.filter((l) => !isKnownResult(mapJobsucheListing(l), exclude));
      // Never more details than the budget; a posting without them would be mislabelled board-only, so it's left out.
      const detailed = fresh.slice(0, detailBudget);
      detailBudget -= detailed.length;
      const details = detailed.length > 0 ? await fetchDetails(detailed, signal) : new Map<string, JobsucheDetails | null>();
      const batch = dropStalePostings(detailed.map((l) => mapJobsucheListing(l, details.get(l.referenznummer), term || undefined))).filter(
        (r) => !isKnownResult(r, exclude),
      );
      results.push(...batch);
      if (batch.length > 0) onResults?.(batch);
    } catch (err) {
      if (signal?.aborted) break;
      failed++;
      firstError ??= err;
      warnings.push(`Arbeitsagentur "${term || "all jobs"}" — ${err instanceof Error ? err.message : "search failed"}`);
    }
    if (i < terms.length - 1) await sleep(REQUEST_GAP_MS, signal);
  }
  if (failed === terms.length && firstError) throw firstError;
  return { results, warnings };
}

/**
 * Whether this runtime may fetch the BA's API: the extension needs the optional host permission
 * (the API sends no CORS headers for other origins); outside the extension (FillerAgent's Node side,
 * no `chrome.permissions`) there's nothing to grant.
 */
export async function hasJobsucheAccess(): Promise<boolean> {
  const permissions = (globalThis as { chrome?: { permissions?: { contains?: (p: { origins: string[] }) => Promise<boolean> } } }).chrome?.permissions;
  if (typeof permissions?.contains !== "function") return true;
  try {
    return await permissions.contains({ origins: [JOBSUCHE_ORIGIN] });
  } catch {
    return false;
  }
}
