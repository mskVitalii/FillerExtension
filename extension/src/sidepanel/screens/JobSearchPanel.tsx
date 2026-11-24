import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/i18n/react";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { sendMessage, type MessageOf, type RuntimeMessage } from "@/types/messages";
import { JOB_GRADES, type JobGrade, type JobSearchProvider, JobSearchResult, JobSearchTiming } from "@/types/job-search";
import { getJobSearchState, setJobSearchState } from "@/features/storage/session";
import { getJobSearchVisitedLinks, recordJobSearchLinkVisit } from "@/features/storage/local";
import { cn } from "@/lib/utils";
import { formatPostedAgo } from "@/features/job-search/freshness";
import { MAX_NEGATIVE_PROMPT_LENGTH, splitByNegative } from "@/features/job-search/negative";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { AiErrorMessage } from "@/components/AiErrorMessage";
import { SourceChips } from "@/components/SourceChips";
import { isGermanSearch, JOBSUCHE_ORIGIN } from "@/features/job-search/jobsuche-provider";
import { mergeSourceResults } from "@/features/job-search/merge-sources";
import { getProfile } from "@/features/profile/repository";

/** `chrome.storage.sync` allows ~120 writes a minute — save once typing pauses, not per keystroke. */
const SAVE_NEGATIVE_DELAY_MS = 800;

/**
 * Dedupes across pages and sources — needed once "load more" starts appending to the same list, and
 * since a posting can come from two sources (Tavily and the Arbeitsagentur): it shows once, with both tags.
 */
function dedupeByUrl(jobs: JobSearchResult[]): JobSearchResult[] {
  return mergeSourceResults(jobs);
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

/** "850 ms", "4.2 s", "38 s", "1 min 5 s". */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** Ticks once a second while `running`, so a long web search shows it's still alive instead of a static "Searching…". */
function useElapsedSeconds(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
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
  personalLegend: string;
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
  jobsuche: "Arbeitsagentur (Germany)",
};

/**
 * spec_5 section C — a job-search tab alongside the single-posting workflow
 * the rest of the panel covers: query the internet (via OpenAI's own web
 * search or Tavily) or Adzuna's job-listings API for open roles, then open
 * whichever one looks worth applying to in a new tab, where the usual
 * extract → cover letter → autofill flow picks up.
 */
export function JobSearchPanel({ hasApiKey, personalLegend, onBack, onOpenSettings }: JobSearchPanelProps) {
  const t = useT();
  const [provider, setProvider] = useState<JobSearchProvider>("openai");
  const [what, setWhat] = useState("");
  const [where, setWhere] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [grades, setGrades] = useState<JobGrade[]>([]);
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
  const [timing, setTiming] = useState<JobSearchTiming | null>(null);
  const [negative, setNegative] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  /** Results already streamed in by the running search (`JOB_SEARCH_PROGRESS`), shown before it finishes. */
  const [streamed, setStreamed] = useState<JobSearchResult[]>([]);
  const elapsed = useElapsedSeconds(searching || loadingMore);
  const hasLoadedRef = useRef(false);
  const negativeLoadedRef = useRef(false);
  const searchIdRef = useRef<string | null>(null);
  /** "Also search the Arbeitsagentur" (Settings) and whether Chrome lets the extension reach its API. */
  const [jobsucheEnabled, setJobsucheEnabled] = useState(true);
  const [jobsucheAccess, setJobsucheAccess] = useState(true);
  const [profileCountry, setProfileCountry] = useState("");
  /** Asked once per panel for the side search; picking the Arbeitsagentur as provider asks every time. */
  const askedJobsucheRef = useRef(false);
  const jobsucheWanted = provider === "jobsuche" || (jobsucheEnabled && isGermanSearch(where, profileCountry));

  // The offline negative filter runs here, not in the background, so editing
  // the field re-filters the results already on screen without a new search.
  const split = useMemo(() => splitByNegative(results, negative), [results, negative]);
  const streamedVisible = useMemo(() => splitByNegative(streamed, negative).kept, [streamed, negative]);
  const visibleResults = showHidden ? results : split.kept;
  const hiddenTerms = useMemo(() => new Map(split.hidden.map(({ result, term }) => [result.url, term])), [split]);

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
        setGrades(state.grades ?? []);
        setTags(state.tags);
        setResults(state.results);
        setSearched(state.searched);
        setPage(state.page);
        setWarnings(state.warnings);
        setTiming(state.timing ?? null);
      }
      setVisitedLinks(new Set(visited));
      hasLoadedRef.current = true;
    })();
    void getPreferences().then((prefs) => {
      setNegative(prefs.jobSearchNegativePrompt);
      setJobsucheEnabled(prefs.jobsucheEnabled);
      negativeLoadedRef.current = true;
    });
    void getProfile()
      .then((profile) => setProfileCountry(profile.country ?? ""))
      .catch(() => {});
    const checkAccess = () =>
      void chrome.permissions
        .contains({ origins: [JOBSUCHE_ORIGIN] })
        .then(setJobsucheAccess)
        .catch(() => setJobsucheAccess(false));
    checkAccess();
    // @types/chrome lists only addListener on these; the real events have removeListener too.
    const events = [chrome.permissions.onAdded, chrome.permissions.onRemoved] as unknown as chrome.events.Event<() => void>[];
    for (const event of events) event.addListener(checkAccess);
    return () => {
      for (const event of events) event.removeListener(checkAccess);
    };
  }, []);

  /**
   * Must run before anything is awaited in a click handler: `permissions.request` needs the user
   * gesture. Resolves with whether access is there now; the search goes on either way (without it the
   * background skips the Arbeitsagentur with a warning, or errors when it's the chosen provider).
   */
  function requestJobsucheAccess(): Promise<boolean> {
    askedJobsucheRef.current = true;
    return chrome.permissions
      .request({ origins: [JOBSUCHE_ORIGIN] })
      .then((granted) => {
        setJobsucheAccess(granted);
        return granted;
      })
      .catch(() => false);
  }

  // A durable preference (sync), unlike the rest of this screen's session state.
  useEffect(() => {
    if (!negativeLoadedRef.current) return;
    const id = setTimeout(() => void setPreferences({ jobSearchNegativePrompt: negative }), SAVE_NEGATIVE_DELAY_MS);
    return () => clearTimeout(id);
  }, [negative]);

  useEffect(() => {
    function handleProgress(message: RuntimeMessage) {
      if (message.type === "JOB_SEARCH_PROGRESS" && message.searchId === searchIdRef.current) {
        setStreamed((prev) => dedupeByUrl([...prev, ...message.results]));
      }
    }
    chrome.runtime.onMessage.addListener(handleProgress);
    return () => chrome.runtime.onMessage.removeListener(handleProgress);
  }, []);

  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void setJobSearchState({ provider, what, where, remoteOnly, grades, tags, results, searched, page, warnings, timing });
  }, [provider, what, where, remoteOnly, grades, tags, results, searched, page, warnings, timing]);

  function handleAddTag() {
    const tag = tagDraft.trim();
    if (!tag || tags.includes(tag)) {
      setTagDraft("");
      return;
    }
    setTags((prev) => [...prev, tag]);
    setTagDraft("");
  }

  function handleToggleGrade(grade: JobGrade) {
    setGrades((prev) => (prev.includes(grade) ? prev.filter((g) => g !== grade) : [...prev, grade]));
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
    setTiming(null);
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
      const suggestion = await sendMessage<MessageOf<"SEARCH_QUERY_SUGGESTION">>({
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
    // First, with nothing awaited before it: the permission prompt needs this click's gesture.
    const access =
      jobsucheWanted && !jobsucheAccess && (provider === "jobsuche" || !askedJobsucheRef.current) ? requestJobsucheAccess() : null;
    (loadMore ? setLoadingMore : setSearching)(true);
    setError(null);
    setWarnings([]);
    setTiming(null);
    if (!loadMore) setSearched(true);
    setStreamed([]);
    const searchId = crypto.randomUUID();
    searchIdRef.current = searchId;
    const nextPage = loadMore ? page + 1 : 1;
    try {
      if (access) await access;
      const response = await sendMessage<MessageOf<"JOB_SEARCH_RESULTS">>({
        type: "SEARCH_JOBS",
        query: { provider, what, where, remoteOnly, grades, tags, negative: negative.trim() },
        page: nextPage,
        excludeResults: loadMore ? results : undefined,
        searchId,
      });
      setWhat(response.resolvedQuery.what);
      setWhere(response.resolvedQuery.where);
      setTags(response.resolvedQuery.tags ?? []);
      setPage(nextPage);
      setResults((prev) => dedupeByUrl(loadMore ? [...prev, ...response.results] : response.results));
      setWarnings(response.warnings ?? []);
      setTiming({ totalMs: response.totalMs, stages: response.stages });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("search.failed"));
      if (!loadMore) setResults([]);
    } finally {
      searchIdRef.current = null;
      setStreamed([]);
      (loadMore ? setLoadingMore : setSearching)(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("common.back")}
        </button>
        <h1 className="text-base font-semibold">{t("search.title")}</h1>
        <span />
      </div>

      {!hasApiKey && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {t("search.needsKey")}
        </p>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-muted/20 p-2">
        <p className="text-xs text-muted-foreground">
          {t("search.grounded")}
        </p>
        {personalLegend ? (
          <p className="text-xs italic text-muted-foreground">"{summaryPreview(personalLegend)}"</p>
        ) : (
          <p className="text-xs text-muted-foreground">{t("search.noLegend")}</p>
        )}
        <button
          onClick={onOpenSettings}
          className="w-fit text-xs text-muted-foreground underline underline-offset-2"
        >
          {personalLegend ? t("search.editInSettings") : t("search.writeInSettings")}
        </button>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("search.provider")}</label>
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
                {t("search.terms")}
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
                        aria-label={t("search.removeTag", { tag })}
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
                placeholder={t("search.termsPlaceholder")}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t("search.role")}</label>
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
                placeholder={t("search.rolePlaceholder")}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("job.location")}</label>
            <Input value={where} onChange={(e) => setWhere(e.target.value)} placeholder={t("search.locationPlaceholder")} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("search.grade")}</label>
            <div className="flex flex-wrap gap-1.5">
              {JOB_GRADES.map(({ id, label }) => {
                const active = grades.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => handleToggleGrade(id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
            {t("search.remoteOnly")}
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="job-search-negative" className="text-xs text-muted-foreground">
              {t("search.negative")}
            </label>
            <Input
              id="job-search-negative"
              value={negative}
              maxLength={MAX_NEGATIVE_PROMPT_LENGTH}
              onChange={(e) => setNegative(e.target.value)}
              placeholder={t("search.negativePlaceholder")}
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void handleSuggest()} disabled={suggesting}>
              <Sparkles className="mr-1 h-3 w-3" />
              {suggesting ? t("search.suggesting") : t("search.suggest")}
            </Button>
            <Button size="sm" onClick={() => void handleSearch(false)} disabled={searching}>
              {searching ? t("search.searching", { seconds: elapsed }) : t("search.search")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <AiErrorMessage text={error} />}

      {jobsucheWanted && !jobsucheAccess && (
        <p className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          {t("search.jobsucheAccess")}
          <button onClick={() => void requestJobsucheAccess()} className="underline underline-offset-2 hover:text-foreground">
            {t("search.jobsucheAllow")}
          </button>
        </p>
      )}

      {warnings.length > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
          {t("search.partial", { warnings: warnings.join(" · ") })}
        </p>
      )}

      {searched && !searching && !error && results.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("search.none")}</p>
      )}

      {searching && streamedVisible.length > 0 && (
        <div className="flex flex-col gap-2">
          {streamedVisible.map((job, i) => (
            <JobResultCard
              key={`${job.url}-${i}`}
              job={job}
              visited={visitedLinks.has(job.url)}
              onVisit={() => handleVisitLink(job.url)}
            />
          ))}
        </div>
      )}

      {searching && <JobResultSkeleton />}

      {!searching && split.hidden.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("search.hidden", { count: split.hidden.length })}{" "}
          <button
            onClick={() => setShowHidden((prev) => !prev)}
            className="underline underline-offset-2 hover:text-foreground"
          >
            {showHidden ? t("search.hideThem") : t("search.showThem")}
          </button>
        </p>
      )}

      {!searching && !loadingMore && timing && <SearchTimingSummary timing={timing} />}

      {!searching && provider === "adzuna" && groupByTag(visibleResults).length > 1 ? (
        <div className="flex flex-col gap-3">
          {groupByTag(visibleResults).map(({ tag, jobs }) => (
            <div key={tag} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {tag} <span className="font-normal normal-case">({jobs.length})</span>
              </h4>
              {jobs.map((job, i) => (
                <JobResultCard
                  key={`${job.url}-${i}`}
                  job={job}
                  visited={visitedLinks.has(job.url)}
                  hiddenBy={hiddenTerms.get(job.url)}
                  onVisit={() => handleVisitLink(job.url)}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        !searching && (
          <div className="flex flex-col gap-2">
            {visibleResults.map((job, i) => (
              <JobResultCard
                key={`${job.url}-${i}`}
                job={job}
                visited={visitedLinks.has(job.url)}
                hiddenBy={hiddenTerms.get(job.url)}
                onVisit={() => handleVisitLink(job.url)}
              />
            ))}
          </div>
        )
      )}

      {loadingMore && streamedVisible.length > 0 && (
        <div className="flex flex-col gap-2">
          {streamedVisible.map((job, i) => (
            <JobResultCard
              key={`${job.url}-${i}`}
              job={job}
              visited={visitedLinks.has(job.url)}
              onVisit={() => handleVisitLink(job.url)}
            />
          ))}
        </div>
      )}

      {loadingMore && <JobResultSkeleton />}

      <div className="flex gap-2">
        {searched && results.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void handleSearch(true)} disabled={loadingMore}>
            {loadingMore ? t("search.loadingMore", { seconds: elapsed }) : t("search.more")}
          </Button>
        )}
        {results.length > 0 && (
          <Button size="sm" variant="ghost" onClick={handleClearResults}>
            {t("search.clear")}
          </Button>
        )}
      </div>
    </div>
  );
}

function SearchTimingSummary({ timing }: { timing: JobSearchTiming }) {
  return (
    <p className="text-xs text-muted-foreground">
      Took <span className="font-medium text-foreground">{formatDuration(timing.totalMs)}</span>
      {timing.stages.length > 0 && (
        <>
          {" — "}
          {timing.stages.map((stage) => `${stage.label} ${formatDuration(stage.ms)}`).join(" · ")}
        </>
      )}
    </p>
  );
}

function JobResultCard({
  job,
  visited,
  hiddenBy,
  onVisit,
}: {
  job: JobSearchResult;
  visited: boolean;
  /** The negative term this result matched — set only while hidden results are shown. */
  hiddenBy?: string;
  onVisit: () => void;
}) {
  const t = useT();
  return (
    <Card
      className={cn(
        "transition-opacity",
        visited && "border-dashed bg-muted/70 opacity-45 shadow-none grayscale hover:opacity-80",
      )}
    >
      <CardContent className="flex flex-col gap-1 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className={cn("truncate text-sm", visited ? "font-normal text-muted-foreground" : "font-medium")}>{job.title}</p>
              {visited && (
                <span className="shrink-0 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("search.visited")}
                </span>
              )}
              {hiddenBy && (
                <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                  Matches "{hiddenBy}"
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
            aria-label={t("apps.openPosting")}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
        <SourceChips result={job} />
        {(job.salary || formatPostedAgo(job.postedAt)) && (
          <p className="text-xs text-muted-foreground">
            {[job.salary, formatPostedAgo(job.postedAt)].filter(Boolean).join(" · ")}
          </p>
        )}
        {job.snippet && <p className="text-xs text-muted-foreground">{job.snippet}</p>}
      </CardContent>
    </Card>
  );
}
