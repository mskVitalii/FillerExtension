import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sendMessage, type MessageOf } from "@/types/messages";
import { EMPTY_JOB, type Job } from "@/types/job";
import type { JobSearchResult } from "@/types/job-search";
import {
  getCollectedLinkedInJobs,
  onCollectedLinkedInJobsChanged,
  removeCollectedLinkedInJobs,
  type CollectedLinkedInJob,
} from "@/features/linkedin-collector/store";
import {
  getLinkedInCollectorSettings,
  hasLinkedInPermission,
  requestLinkedInPermission,
  setLinkedInCollectorEnabled,
} from "@/features/linkedin-collector/registration";
import { isJobBoardUrl } from "@/features/linkedin-collector/employer-posting";
import { applyViaAgent, getAgentSettings } from "@/features/agent-bridge/client";
import { syncWithAgent } from "@/features/agent-bridge/sync";
import { SourceChips } from "@/components/SourceChips";

/** Newest first; the rest behind "Show all" so a long list doesn't push the search off screen. */
const COLLAPSED_COUNT = 5;

interface Lookup {
  state: "loading" | "done" | "error";
  candidates: JobSearchResult[];
  error?: string;
  /** Per candidate URL: "sending", or the agent's answer / error. */
  sent: Record<string, string>;
}

/**
 * Job Search → "From LinkedIn": the switch for the on-page collector and the jobs collected with
 * it. A LinkedIn link is a lead only — "Find employer's posting" looks the job up on the open web
 * (Tavily), and only the employer's own posting can go to the local agent.
 */
export function LinkedInCollected() {
  const t = useT();
  const [enabled, setEnabled] = useState(false);
  const [denied, setDenied] = useState(false);
  const [jobs, setJobs] = useState<CollectedLinkedInJob[]>([]);
  const [lookups, setLookups] = useState<Record<string, Lookup>>({});
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    void Promise.all([getLinkedInCollectorSettings(), hasLinkedInPermission()]).then(([settings, granted]) => setEnabled(settings.enabled && granted));
    void getCollectedLinkedInJobs().then(setJobs);
    return onCollectedLinkedInJobsChanged(setJobs);
  }, []);

  function handleEnable() {
    // The permission prompt needs this click's user gesture — no await before it.
    void requestLinkedInPermission().then(async (granted) => {
      setDenied(!granted);
      if (!granted) return;
      await setLinkedInCollectorEnabled(true);
      setEnabled(true);
    });
  }

  async function handleDisable() {
    await setLinkedInCollectorEnabled(false);
    setEnabled(false);
  }

  const patchLookup = (id: string, patch: Partial<Lookup>) =>
    setLookups((prev) => {
      const base: Lookup = prev[id] ?? { state: "loading", candidates: [], sent: {} };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  async function handleFind(job: CollectedLinkedInJob) {
    patchLookup(job.id, { state: "loading", candidates: [], error: undefined, sent: {} });
    try {
      const reply = await sendMessage<MessageOf<"EMPLOYER_POSTING_CANDIDATES">>({
        type: "FIND_EMPLOYER_POSTING",
        title: job.title,
        company: job.company,
        location: job.location,
      });
      patchLookup(job.id, { state: "done", candidates: reply.candidates });
    } catch (err) {
      patchLookup(job.id, { state: "error", error: (err as Error).message });
    }
  }

  async function handleSend(job: CollectedLinkedInJob, candidate: JobSearchResult) {
    const setSent = (value: string) =>
      setLookups((prev) => ({ ...prev, [job.id]: { ...prev[job.id], sent: { ...prev[job.id]?.sent, [candidate.url]: value } } }));
    // Never a job board, never LinkedIn: the agent applies on the employer's own site only.
    if (isJobBoardUrl(candidate.url)) return;
    const settings = await getAgentSettings();
    if (!settings) {
      setSent(t("linkedin.noAgent"));
      return;
    }
    setSent("sending");
    try {
      // The agent should have the user's current data before it applies (as "Apply via AI agent" does).
      await syncWithAgent(settings).catch(() => undefined);
      const posting: Job = {
        ...EMPTY_JOB,
        position: job.title,
        company: job.company,
        location: job.location,
        description: candidate.snippet,
        url: candidate.url,
      };
      const created = await applyViaAgent(settings, candidate.url, posting);
      setSent(t("linkedin.sent", { status: created.status }));
    } catch (err) {
      setSent((err as Error).message);
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t("linkedin.title", { count: jobs.length })}</h2>
          {jobs.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => void removeCollectedLinkedInJobs("all")}>
              {t("linkedin.clear")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{enabled ? t("linkedin.enabledHint") : t("linkedin.intro")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {enabled ? (
            <Button size="sm" variant="outline" onClick={() => void handleDisable()}>
              {t("linkedin.disable")}
            </Button>
          ) : (
            <Button size="sm" onClick={handleEnable}>
              {t("linkedin.enable")}
            </Button>
          )}
        </div>
        {denied && <p className="text-xs text-destructive">{t("linkedin.denied")}</p>}

        {jobs.length === 0 ? (
          enabled && <p className="text-xs text-muted-foreground">{t("linkedin.empty")}</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{t("linkedin.agentNote")}</p>
            <ul className="flex flex-col gap-2">
              {[...jobs].reverse().slice(0, showAll ? undefined : COLLAPSED_COUNT).map((job) => (
                <CollectedRow
                  key={job.id}
                  job={job}
                  lookup={lookups[job.id]}
                  onFind={() => void handleFind(job)}
                  onSend={(candidate) => void handleSend(job, candidate)}
                  onRemove={() => void removeCollectedLinkedInJobs([job.id])}
                />
              ))}
            </ul>
            {jobs.length > COLLAPSED_COUNT && (
              <button onClick={() => setShowAll((prev) => !prev)} className="w-fit text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
                {showAll ? t("linkedin.showLess") : t("linkedin.showAll", { count: jobs.length })}
              </button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CollectedRow({
  job,
  lookup,
  onFind,
  onSend,
  onRemove,
}: {
  job: CollectedLinkedInJob;
  lookup: Lookup | undefined;
  onFind: () => void;
  onSend: (candidate: JobSearchResult) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{job.title || `LinkedIn job ${job.id}`}</p>
            <SourceChips result={job} />
          </div>
          <p className="truncate text-xs text-muted-foreground">{[job.company, job.location].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t("linkedin.open")}
            title={t("linkedin.open")}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <button onClick={onRemove} className="text-muted-foreground hover:text-foreground" aria-label={t("linkedin.remove")} title={t("linkedin.remove")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div>
        <Button size="sm" variant="outline" onClick={onFind} disabled={lookup?.state === "loading" || !job.title || !job.company}>
          {lookup?.state === "loading" ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {t("linkedin.finding")}
            </>
          ) : (
            t("linkedin.find")
          )}
        </Button>
      </div>
      {lookup?.state === "error" && <p className="text-xs text-destructive">{lookup.error}</p>}
      {lookup?.state === "done" && lookup.candidates.length === 0 && <p className="text-xs text-muted-foreground">{t("linkedin.notFound")}</p>}
      {lookup?.state === "done" &&
        lookup.candidates.map((candidate) => {
          const sent = lookup.sent[candidate.url];
          return (
            <div key={candidate.url} className="flex flex-col gap-1 rounded border border-border bg-muted/30 p-2">
              <a href={candidate.url} target="_blank" rel="noreferrer" className="truncate text-xs font-medium underline underline-offset-2">
                {candidate.title || candidate.url}
              </a>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[11px] text-muted-foreground">{new URL(candidate.url).hostname}</span>
                <SourceChips result={candidate} />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => onSend(candidate)} disabled={sent === "sending"}>
                  {sent === "sending" ? t("linkedin.sending") : t("linkedin.sendToAgent")}
                </Button>
                {sent && sent !== "sending" && <span className="text-xs text-muted-foreground">{sent}</span>}
              </div>
            </div>
          );
        })}
    </li>
  );
}
