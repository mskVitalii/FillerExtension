import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, Search, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { deleteApplication, getAllApplications, setApplicationStatus } from "@/features/applications/repository";
import { computeSubmissionStats, type SubmissionStats } from "@/features/applications/stats";
import { getUrlActivationsWithBackfill, removeUrlActivation } from "@/features/storage/local";
import type { Application, ApplicationStatus, UrlActivation } from "@/types/application";

const STATUS_OPTIONS: ApplicationStatus[] = ["draft", "applied", "interview", "rejected", "offer"];
const EMPTY_STATS: SubmissionStats = { total: 0, avgPerDay: 0, byDay: [] };

interface ApplicationsListProps {
  onBack: () => void;
}

/** `YYYY-MM-DD` -> `DD.MM`, compact enough to sit under a ~40px-wide bar. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

/**
 * spec_6 — a chart of every unique job URL the extension was activated on
 * (a rough proxy for "applied to", independent of whether a cover letter
 * was ever saved to Drive — see `recordUrlActivation`), one bar per day
 * that had at least one, scaled to that day's share of the busiest day.
 * Each bar gets its own visible count and date underneath (not just a
 * hover title, which is easy to miss in a narrow side panel) when there's
 * room; past ~8 bars only every Nth one gets a label so they don't run
 * into each other, while every bar keeps its exact count in its hover
 * title regardless.
 */
function SubmissionsChart({ byDay }: { byDay: SubmissionStats["byDay"] }) {
  if (byDay.length === 0) return null;
  const max = Math.max(...byDay.map((d) => d.count));
  const labelEvery = Math.max(1, Math.ceil(byDay.length / 8));
  return (
    <div className="flex flex-col gap-1 rounded-md border border-border bg-muted/20 p-1">
      <div className="flex gap-px">
        {byDay.map((d, i) => (
          <div key={d.date} className="flex-1 truncate text-center text-[9px] font-medium text-foreground">
            {i % labelEvery === 0 ? d.count : ""}
          </div>
        ))}
      </div>
      <div className="flex h-14 items-end gap-px">
        {byDay.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.count} unique URL${d.count === 1 ? "" : "s"}`}
            className="min-w-[3px] flex-1 rounded-sm bg-primary/70"
            style={{ height: `${Math.max(8, (d.count / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="flex gap-px">
        {byDay.map((d, i) => (
          <div key={d.date} title={d.date} className="flex-1 truncate text-center text-[9px] text-muted-foreground">
            {i % labelEvery === 0 ? shortDate(d.date) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

/** One row in the combined list below the chart — every URL ever activated, joined with its saved Application when one exists. */
interface ActivityRow {
  url: string;
  /** `YYYY-MM-DD`, the day the extension was first activated on `url`. */
  date: string;
  application: Application | null;
}

/**
 * `activations` (after `getUrlActivationsWithBackfill`) is a superset of
 * `applications` by URL — backfill adds one activation entry for every
 * Drive-saved application that predates the activation log, so every
 * application is guaranteed a matching row here. Sorted most-recent-first,
 * preferring the application's own `updatedAt` (full timestamp) over the
 * activation's day-only `date` when both exist.
 */
function buildActivityRows(applications: Application[], activations: UrlActivation[]): ActivityRow[] {
  const appByUrl = new Map(applications.map((app) => [app.url, app]));
  return activations
    .map((activation) => ({
      url: activation.url,
      date: activation.date,
      application: appByUrl.get(activation.url) ?? null,
    }))
    .sort((a, b) => (b.application?.updatedAt ?? b.date).localeCompare(a.application?.updatedAt ?? a.date));
}

/** Every job URL the extension was ever activated on (spec_6), each tagged "Cover letter" when a draft was saved to Drive. */
export function ApplicationsList({ onBack }: ApplicationsListProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activations, setActivations] = useState<UrlActivation[]>([]);
  const [stats, setStats] = useState<SubmissionStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Backfill depends on the just-fetched application list, so this can't
      // run in parallel with it the way the original two fetches did.
      const apps = await getAllApplications();
      const activations = await getUrlActivationsWithBackfill(apps);
      setApplications(apps);
      setActivations(activations);
      setStats(computeSubmissionStats(activations));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load applications from Drive.");
    } finally {
      setLoading(false);
    }
  }

  async function handleStatusChange(app: Application, status: ApplicationStatus) {
    setApplications((apps) => apps.map((a) => (a.id === app.id ? { ...a, status } : a)));
    await setApplicationStatus(app.id, status);
  }

  async function handleDelete(row: ActivityRow) {
    setDeletingUrl(row.url);
    try {
      if (row.application) await deleteApplication(row.application.id);
      await removeUrlActivation(row.url);
      setApplications((apps) => apps.filter((a) => a.url !== row.url));
      setActivations((entries) => entries.filter((a) => a.url !== row.url));
    } finally {
      setDeletingUrl(null);
    }
  }

  const rows = buildActivityRows(applications, activations);
  const query = search.trim().toLowerCase();
  const visibleRows = query
    ? rows.filter((row) =>
        [row.application?.position, row.application?.company, row.url]
          .filter(Boolean)
          .some((field) => field!.toLowerCase().includes(query)),
      )
    : rows;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-base font-semibold">Applications</h1>
        <span />
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading from Google Drive…</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && !error && stats.total > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-muted-foreground">Submissions over time</span>
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{stats.total}</span> unique URLs ·{" "}
              <span className="font-semibold text-foreground">{stats.avgPerDay}</span>/day avg
            </span>
          </div>
          <SubmissionsChart byDay={stats.byDay} />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No job postings tracked yet — run Autofill or generate a cover letter on a posting to save one.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by position, company, or URL…"
            className="h-8 pl-7 text-xs"
          />
        </div>
      )}

      {!loading && !error && rows.length > 0 && visibleRows.length === 0 && (
        <p className="text-sm text-muted-foreground">No matches for "{search}".</p>
      )}

      <div className="flex flex-col gap-2">
        {visibleRows.map((row) => (
          <Card key={row.application?.id ?? row.url}>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {row.application ? (
                    <>
                      <div className="flex items-center gap-1.5">
                        <p className="truncate text-sm font-medium">{row.application.position || "—"}</p>
                        <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                          Cover letter
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{row.application.company || "—"}</p>
                    </>
                  ) : (
                    <p className="truncate text-sm font-medium">{row.url}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Open job posting"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => void handleDelete(row)}
                    disabled={deletingUrl === row.url}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    aria-label="Delete from history"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className={cn("flex items-center gap-2", row.application ? "justify-between" : "justify-end")}>
                {row.application && (
                  <Select
                    className="h-7 w-32 text-xs"
                    value={row.application.status}
                    onChange={(e) => void handleStatusChange(row.application!, e.target.value as ApplicationStatus)}
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </Select>
                )}
                <span className="text-xs text-muted-foreground">
                  {row.application ? new Date(row.application.updatedAt).toLocaleDateString() : row.date}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
