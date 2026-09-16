import { useState } from "react";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { sendMessage } from "@/types/messages";
import type { JobSearchProvider, JobSearchQuery, JobSearchResult } from "@/types/job-search";

/** Dedupes by listing URL — needed once "load more" starts appending to the same list. */
function dedupeByUrl(jobs: JobSearchResult[]): JobSearchResult[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    if (seen.has(job.url)) return false;
    seen.add(job.url);
    return true;
  });
}

interface JobSearchPanelProps {
  hasApiKey: boolean;
  onBack: () => void;
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
export function JobSearchPanel({ hasApiKey, onBack }: JobSearchPanelProps) {
  const [provider, setProvider] = useState<JobSearchProvider>("openai");
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [suggesting, setSuggesting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<JobSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [page, setPage] = useState(1);

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
    if (!loadMore) setSearched(true);
    const nextPage = loadMore ? page + 1 : 1;
    try {
      const response = await sendMessage<{
        type: "JOB_SEARCH_RESULTS";
        results: JobSearchResult[];
        resolvedQuery: JobSearchQuery;
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

      <p className="text-xs text-muted-foreground">
        OpenAI and Tavily search using your full Candidate Summary (profile, CV, Personal
        Legend, languages, FAQ answers — see Settings), not just what you type below. Role/
        location here narrow that search rather than replace it.
      </p>

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

      {provider === "adzuna" && tags.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Searched Adzuna for: <span className="font-medium">{tags.join(", ")}</span>
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {searched && !searching && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">No postings found — try a broader query.</p>
      )}

      <div className="flex flex-col gap-2">
        {results.map((job, i) => (
          <Card key={`${job.url}-${i}`}>
            <CardContent className="flex flex-col gap-1 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{job.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[job.company, job.location].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <a
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
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
        ))}
      </div>

      {searched && results.length > 0 && (
        <Button size="sm" variant="outline" onClick={() => void handleSearch(true)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "More"}
        </Button>
      )}
    </div>
  );
}
