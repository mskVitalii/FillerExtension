import { getApplicantContext, type ApplicantContext } from "@/features/profile/context";
import { getLocal, setLocal, type JobSearchSuggestionCacheEntry } from "@/features/storage/local";
import { suggestSearchQuery } from "@/features/openai/suggest-search-query";
import { suggestSearchTags } from "@/features/openai/suggest-search-tags";

/** A few CVs/legends switched between, not a history. */
const MAX_ENTRIES = 4;

/** Exactly the inputs `suggestSearchQuery`/`suggestSearchTags` read — editing any of them misses the cache. */
export function suggestionInput(context: Pick<ApplicantContext, "profile" | "cvText" | "personalLegend" | "languageLevels">): string {
  return JSON.stringify([
    context.profile.city,
    context.profile.country,
    context.cvText,
    context.personalLegend,
    context.languageLevels.map((l) => l.language),
  ]);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface CachedSuggestion {
  what: string;
  where: string;
  tags?: string[];
  /** True when nothing had to be asked of the AI. */
  cached: boolean;
}

/**
 * The CV-derived query (and, with `withTags`, Adzuna's tag set), reused for as
 * long as the CV/legend/profile behind it is unchanged. Without this, every
 * blank-field Adzuna search and every "Suggest from CV" paid one or two AI
 * round trips (several seconds) for the same answer again. Kept in
 * `chrome.storage.local` because the service worker's memory doesn't survive
 * an unload.
 */
export async function getSearchSuggestion(withTags: boolean): Promise<CachedSuggestion> {
  const key = await sha256(suggestionInput(await getApplicantContext()));
  const entries = (await getLocal("jobSearchSuggestionCache")) ?? [];
  const hit = entries.find((entry) => entry.key === key);
  if (hit && (!withTags || hit.tags)) return { what: hit.what, where: hit.where, tags: hit.tags, cached: true };

  const [query, tags] = await Promise.all([
    hit ? { what: hit.what, where: hit.where } : suggestSearchQuery(),
    withTags ? suggestSearchTags() : Promise.resolve(undefined),
  ]);
  const entry: JobSearchSuggestionCacheEntry = { key, ...query, tags: tags?.length ? tags : hit?.tags };
  // An empty answer is no answer — let the next search ask again.
  if (entry.what || entry.tags?.length) {
    await setLocal("jobSearchSuggestionCache", [entry, ...entries.filter((e) => e.key !== key)].slice(0, MAX_ENTRIES));
  }
  return { what: entry.what, where: entry.where, tags: entry.tags, cached: false };
}
