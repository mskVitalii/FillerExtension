import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { sendMessage } from "@/types/messages";
import type { JobSearchProvider, JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { getJobSearchState, setJobSearchState } from "@/features/storage/session";
import { getJobSearchVisitedLinks, recordJobSearchLinkVisit } from "@/features/storage/local";
import { cn } from "@/lib/utils";

/** Dedupes by listing URL — needed once "load more" starts appending to the same list. */
function dedupeByUrl(jobs: JobSearchResult[]): JobSearchResult[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });
}

/** Groups Adzuna results by their originating search tag (spec_7 item 13), preserving first-seen tag order; untagged results (shouldn't normally happen) fall into one trailing "Other" group. */
function groupByTag(jobs: JobSearchResult[]): { tag: string; jobs: JobSearchResult[] }[] {
  const order: string[] = [];
  const byTag = new Map<string, JobSearchResult[]>();
  for (const job of jobs) {
    const tag = job.tag ?? "Other";
    if (!byTag.has(tag)) {
      order.push(tag);
      byTag.set(tag, []);
    }
    byTag.get(tag)!.push(job);
  }
  return order.map((tag) => ({ tag, jobs: byTag.get(tag)! }));
}

/** Shimmering placeholder cards (spec_7 item 14) shown while a search is in flight — no skeleton pattern existed anywhere in the app yet. */
function JobResultSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <CardContent className="flex flex-col gap-2 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              </div>
            </div>
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface JobSearchPanelProps {
  hasApiKey: boolean;
  candidateSummary: string;
  onBack: () => void;
  onOpenSettings: () => void;
}

/** Kept short — this is a preview so the user can tell at a glance whether it's stale, not a full read here. */
function summaryPreview(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  return trimmed.length > 220 ? `${trimmed.slice(0, 220)}…` : trimmed;
}

const PROVIDER_LABELS: Record<JobSearchProvider, string> = {
  openai: "OpenAI web search",
  tavily: "Tavily",
  adzuna: "Adzuna",
};

/**
 * spec_5 section C — a job-search tab alongside the single-posting workflow
 * the rest of the panel covers: query the internet (via OpenAI's own web
 * search or Tavily) or Adzuna's job-listings API for open roles, then open
 * whichever one looks worth applying to in a new tab, where the usual
 * extract → cover letter → autofill flow picks up.
 */
export function JobSearchPanel({ hasApiKey, candidateSummary, onBack, onOpenSettings }: JobSearchPanelProps) {
  const [provider, setProvider] = useState<JobSearchProvider>("openai");
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);
  const [visitedLinks, setVisitedLinks] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);

  // Restores the last query/results (spec_7 item 15) — opening the Side
  // Panel on a different tab gets its own fresh document, so without this
  // the Job Search tab would silently reset to empty every time.
  useEffect(() => {
    void (async () => {
      const [state, visited] = await Promise.all([getJobSearchState(), getJobSearchVisitedLinks()]);
      if (state) {
        setProvider(state.provider);
        setWhat(state.what);
        setWhere(state.where);
        setRemoteOnly(state.remoteOnly);
        setTags(state.tags);
        setResults(state.results);
        setSearched(state.searched);
        setPage(state.page);
        setWarnings(state.warnings);
      }
      setVisitedLinks(new Set(visited));
      hasLoadedRef.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void setJobSearchState({ provider, what, where, remoteOnly, tags, results, searched, page, warnings });
  }, [provider, what, where, remoteOnly, tags, results, searched, page, warnings]);

  function handleAddTag() {
    const tag = tagDraft.trim();
    if (!tag || tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    setTags((prev) => [...prev, tag]);
    setTagDraft("");
  }

  function handleRemoveTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  /** spec_7 item 16 — clears the results list without discarding the query, so re-running the same search is one click. */
  function handleClearResults() {
    setResults([]);
    setSearched(false);
    setPage(1);
    setWarnings([]);
    setError(null);
  }

  /** spec_7 item 17 — recorded on click, not derived from a full history; the visited badge updates optimistically. */
  function handleVisitLink(url: string) {
    setVisitedLinks((prev) => new Set(prev).add(url));
    void recordJobSearchLinkVisit(url);
  }

  async function handleSuggest() {
    setSuggesting(true);
    setError(null);
    try {
      const suggestion = await sendMessage<{
        type: "SEARCH_QUERY_SUGGESTION";
        what: string;
        where: string;
        tags?: string[];
      }>({
        type: "SUGGEST_SEARCH_QUERY",
        provider,
      });
      if (!what) setWhat(suggestion.what);
      if (!where) setWhere(suggestion.where);
      // Lock the AI-derived atomic tags in now (Adzuna only) so Search fans
      // out over them instead of later treating the single combined "what"
      // text above as a deliberate manual keyword override — see the
      // `SUGGEST_SEARCH_QUERY` handler in router.ts.
      if (provider === "adzuna" && tags.length === 0 && suggestion.tags?.length) {
        setTags(suggestion.tags);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't suggest a query from your CV.");
    } finally {
      setSuggesting(false);
    }
  }

  /**
   * `loadMore` reuses the current provider/query, asks for page+1 (Adzuna)
   * or passes the results already shown as `excludeResults` (OpenAI/Tavily
   * have no real pagination — this asks the live web search for genuinely
   * different postings instead of the same top hits again), and appends
   * rather than replaces. `resolvedQuery` is locked back into the "what"/
   * "where" fields after every search: when the user leaves them blank, the
   * background derives a real query from their CV (particularly for
   * Adzuna's literal keyword search) — locking it in keeps a later "load
   * more" consistent with page 1 instead of re-deriving independently.
   */
  async function handleSearch(loadMore: boolean) {
    (loadMore ? setLoadingMore : setSearching)(true);
    setError(null);
    setWarnings([]);
    if (!loadMore) setSearched(true);
    const nextPage = loadMore ? page + 1 : 1;
    try {
      const response = await sendMessage<{
        type: "JOB_SEARCH_RESULTS";
        results: JobSearchResult[];
        resolvedQuery: JobSearchQuery;
        warnings?: string[];
      }>({
        type: "SEARCH_JOBS",
        query: { provider, what, where, remoteOnly, tags },
        page: nextPage,
        excludeResults: loadMore ? results : undefined,
      });
      setWhat(response.resolvedQuery.what);
      setWhere(response.resolvedQuery.where);
      setTags(response.resolvedQuery.tags ?? []);
      setPage(nextPage);
      setResults((prev) => dedupeByUrl(loadMore ? [...prev, ...response.results] : response.results));
      setWarnings(response.warnings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed.");
      if (!loadMore) setResults([]);
    } finally {
      (loadMore ? setLoadingMore : setSearching)(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-base font-semibold">Job Search</h1>
        <span />
      </div>

      {!hasApiKey && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          OpenAI web search and Tavily both parse their results with your OpenAI key — add it in
          Settings first. Adzuna doesn't need it at all.
        </p>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2">
        <p className="text-xs text-muted-foreground">
          OpenAI and Tavily search using your full Candidate Summary (profile, CV, Personal
          Legend, languages, FAQ answers — see Settings), not just what you type below. Role/
          location here narrow that search rather than replace it.
        </p>
        {candidateSummary ? (
          <p className="text-xs italic text-muted-foreground">"{summaryPreview(candidateSummary)}"</p>
        ) : (
          <p className="text-xs text-muted-foreground">Not generated yet — the first search will generate one.</p>
        )}
        <button
          onClick={onOpenSettings}
          className="w-fit text-xs text-muted-foreground underline underline-offset-2"
        >
          {candidateSummary ? "Edit in Settings" : "Generate in Settings"}
        </button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Provider</label>
            <Select value={provider} onChange={(e) => setProvider(e.target.value as JobSearchProvider)}>
              {(Object.keys(PROVIDER_LABELS) as JobSearchProvider[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABELS[p]}
                </option>
              ))}
            </Select>
          </div>
          {provider === "adzuna" ? (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">
                Search terms — press Enter to add each as its own Adzuna search
              </label>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        aria-label={`Remove "${tag}"`}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="e.g. backend engineer — Enter to add"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Role / keywords</label>
              <Input
                value={what}
                onChange={(e) => {
                  setWhat(e.target.value);
                  // A manual edit invalidates any previously locked-in tag set
                  // (see `resolvedQuery.tags` on `JobSearchQuery`) — otherwise
                  // the background would keep fanning Adzuna out over the old,
                  // now-stale tags instead of the freshly typed keyword.
                  setTags([]);
                }}
                placeholder="e.g. senior backend engineer"
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Location</label>
            <Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. Berlin, Germany" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
            Remote only
          </label>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleSuggest()} disabled={suggesting}>
              <Sparkles className="mr-1 h-3 w-3" />
              {suggesting ? "Suggesting…" : "Suggest from CV"}
            </Button>
            <Button size="sm" onClick={() => void handleSearch(false)} disabled={searching}>
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {warnings.length > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          Some categories were rate-limited or failed; showing partial results. {warnings.join(" · ")}
        </p>
      )}

      {searched && !searching && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No postings found — try a broader query.</p>
      )}

      {searching && <JobResultSkeleton />}

      {!searching && provider === "adzuna" && tags.length > 1 ? (
        <div className="flex flex-col gap-3">
          {groupByTag(results).map(({ tag, jobs }) => (
            <div key={tag} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tag} <span className="font-normal normal-case">({jobs.length})</span>
              </h4>
              {jobs.map((job, i) => (
                <JobResultCard
                  key={`${job.url}-${i}`}
                  job={job}
                  visited={visitedLinks.has(job.url)}
                  onVisit={() => handleVisitLink(job.url)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        !searching && (
          <div className="flex flex-col gap-2">
            {results.map((job, i) => (
              <JobResultCard
                key={`${job.url}-${i}`}
                job={job}
                visited={visitedLinks.has(job.url)}
                onVisit={() => handleVisitLink(job.url)}
              />
            ))}
          </div>
        )
      )}

      {loadingMore && <JobResultSkeleton />}

      <div className="flex gap-2">
        {searched && results.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void handleSearch(true)} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "More"}
          </Button>
        )}
        {results.length > 0 && (
          <Button size="sm" variant="ghost" onClick={handleClearResults}>
            Clear results
          </Button>
        )}
      </div>
    </div>
  );
}

function JobResultCard({
  job,
  visited,
  onVisit,
}: {
  job: JobSearchResult;
  visited: boolean;
  onVisit: () => void;
}) {
  return (
    <Card className={cn(visited && "border-transparent bg-muted opacity-70")}>
      <CardContent className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">{job.title}</p>
              {visited && (
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  Visited
                </span>
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">
              {[job.company, job.location].filter(Boolean).join(" · ")}
            </p>
          </div>
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            onClick={onVisit}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            aria-label="Open job posting"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        {job.salary && <p className="text-xs text-muted-foreground">{job.salary}</p>}
        {job.snippet && <p className="text-xs text-muted-foreground">{job.snippet}</p>}
      </CardContent>
    </Card>
  );
}
