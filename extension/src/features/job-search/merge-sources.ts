import type { JobSearchResult } from "@/types/job-search";
import { resultSources } from "./sources";

/**
 * Cross-source dedupe: the same posting found by Tavily and by the Bundesagentur's Jobsuche (or
 * Adzuna, LinkedIn…) shows once, with every source's tag. Two results are the same posting when
 * their links match once normalized (no scheme, `www.`, trailing slash, fragment or tracking
 * parameters), when one's job-board page is the other's link, or when company and title match once
 * normalized (legal forms, "(m/w/d)" and the like dropped).
 *
 * The result kept is the first one seen, except that a link the agent can apply on (an employer or
 * ATS page) replaces a job-board-only one (`boardOnly`); `sources` gets the union, in order.
 */

const TRACKING_PARAM =
  /^(utm_\w+|gclid|gbraid|wbraid|fbclid|msclkid|mc_[ce]id|_hs\w+|ref|refid|referrer|referer|src|source|trk|trkinfo|trackingid|tracking_id|campaign|cp|lever-source|lever-via|gh_src|icid|ref_src|rx_\w+)$/i;

/** The link reduced to what identifies the posting — only for comparing. */
export function linkKey(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim().toLowerCase();
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const pathname = url.pathname.replace(/\/+$/, "");
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k)).sort(([a], [b]) => a.localeCompare(b));
  return `${host}${pathname}${params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : ""}`;
}

const COMPANY_NOISE =
  /\b(gmbh|mbh|ag|se|kg|kgaa|ohg|gbr|ug|haftungsbeschrankt|co|inc|ltd|limited|llc|plc|corp|corporation|company|sa|sas|srl|bv|nv|group|gruppe|holding|deutschland|germany|niederlassung)\b/g;
const TITLE_NOISE = [/\((?:[mwfdxi*]\s*[/|,]\s*){1,3}[mwfdxi*]\)/gi, /\b(?:[mwfdxi]\s*\/\s*){1,3}[mwfdxi]\b/gi, /\((?:all genders?|alle geschlechter|gn\*?)\)/gi];

function fold(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss");
}

/** `company|title`, normalized; "" when either is missing (then only the link can match). */
export function postingIdentity(company: string, title: string): string {
  const c = fold(company).replace(/&/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").replace(COMPANY_NOISE, " ").replace(/\s+/g, " ").trim();
  let t = title;
  for (const re of TITLE_NOISE) t = t.replace(re, " ");
  t = fold(t).replace(/[^\p{L}\p{N}+#]+/gu, " ").replace(/\s+/g, " ").trim();
  return c && t ? `${c}|${t}` : "";
}

function keysOf(r: JobSearchResult): string[] {
  const keys = [`u:${linkKey(r.url)}`];
  if (r.boardUrl) keys.push(`u:${linkKey(r.boardUrl)}`);
  const id = postingIdentity(r.company, r.title);
  if (id) keys.push(`p:${id}`);
  return keys;
}

function combine(kept: JobSearchResult, other: JobSearchResult): JobSearchResult {
  // An employer/ATS link beats a job-board-only one: that's the one the agent can apply on.
  const [base, extra] = kept.boardOnly && !other.boardOnly ? [other, kept] : [kept, other];
  const sources = resultSources(base);
  for (const s of resultSources(extra)) if (!sources.includes(s)) sources.push(s);
  const merged: JobSearchResult = {
    ...base,
    salary: base.salary || extra.salary,
    snippet: base.snippet || extra.snippet,
    location: base.location || extra.location,
    postedAt: base.postedAt || extra.postedAt,
    boardUrl: base.boardUrl ?? extra.boardUrl ?? (extra.boardOnly ? extra.url : undefined),
    sources,
    sourceIds: { ...extra.sourceIds, ...base.sourceIds },
  };
  if (Object.keys(merged.sourceIds!).length === 0) delete merged.sourceIds;
  if (!merged.boardUrl) delete merged.boardUrl;
  if (!merged.postedAt) delete merged.postedAt;
  if (!merged.boardOnly) delete merged.boardOnly;
  return merged;
}

/** Merges the lists (in order) into one, each posting once with all its sources. */
export function mergeSourceResults(...lists: JobSearchResult[][]): JobSearchResult[] {
  const out: JobSearchResult[] = [];
  const index = new Map<string, number>();
  for (const list of lists) {
    for (const r of list) {
      const keys = keysOf(r);
      const hit = keys.map((k) => index.get(k)).find((i) => i !== undefined);
      if (hit === undefined) {
        out.push(r.sources ? { ...r, sources: resultSources(r) } : r);
        for (const k of keys) index.set(k, out.length - 1);
        continue;
      }
      out[hit] = combine(out[hit], r);
      for (const k of keysOf(out[hit])) index.set(k, hit);
      for (const k of keys) index.set(k, hit);
    }
  }
  return out;
}

/** Whether `r` is already among `known` (by link, job-board page or company + title) — for "load more" excludes. */
export function isKnownResult(r: JobSearchResult, known: JobSearchResult[]): boolean {
  const keys = new Set(known.flatMap(keysOf));
  return keysOf(r).some((k) => keys.has(k));
}
