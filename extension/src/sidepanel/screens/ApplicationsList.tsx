import { useEffect, useState } from "react";
import { ArrowLeft, Download, ExternalLink, Eye, Search, Trash2 } from "lucide-react";
import { SubmissionsTimeline } from "@/components/charts/SubmissionsTimeline";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  deleteApplication,
  getAdaptedCvFile,
  getAllApplications,
  setApplicationStatus,
} from "@/features/applications/repository";
import { computeSubmissionStats, ROLLING_WINDOW_DAYS, type SubmissionStats } from "@/features/applications/stats";
import { downloadFile, openPdfPreview, renderCoverLetterPdf } from "@/features/pdf/export";
import { getUrlActivationsWithBackfill, removeUrlActivation } from "@/features/storage/local";
import type { AdaptedCvRecord, Application, ApplicationStatus, UrlActivation } from "@/types/application";

const STATUS_OPTIONS: ApplicationStatus[] = ["draft", "applied", "interview", "rejected", "offer"];
const EMPTY_STATS: SubmissionStats = { total: 0, lastWindow: 0, avgPerDay: 0, byDay: [], series: [] };

interface ApplicationsListProps {
  onBack: () => void;
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

/** "Backend Engineer · Berlin · Go" — what the adapted CV was filled with, short enough for one line. */
function describeValues(values: Record<string, string>): string {
  return Object.values(values)
    .map((value) => value.split("\n")[0].trim())
    .filter(Boolean)
    .join(" · ");
}

type FileAction = "preview" | "download";

/** A labelled file with its own preview/download icons — a row can carry a cover letter, an adapted CV, or both. */
function FileChip({
  label,
  detail,
  busy,
  onAction,
}: {
  label: string;
  detail?: string;
  busy: boolean;
  onAction: (action: FileAction) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 rounded-md border border-border bg-muted/30 py-0.5 pl-2 pr-1 text-xs">
      <span className="shrink-0 font-medium">{label}</span>
      {detail && (
        <span className="min-w-0 truncate text-muted-foreground" title={detail}>
          · {detail}
        </span>
      )}
      <button
        onClick={() => onAction("preview")}
        disabled={busy}
        className="ml-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Preview ${label}`}
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => onAction("download")}
        disabled={busy}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Download ${label}`}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Every job URL the extension was ever activated on (spec_6). A row with a
 * saved application also carries its files — the cover letter and the
 * adapted CV sent for that posting — each previewable/downloadable in place.
 */
export function ApplicationsList({ onBack }: ApplicationsListProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [activations, setActivations] = useState<UrlActivation[]>([]);
  const [stats, setStats] = useState<SubmissionStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [deletingUrl, setDeletingUrl] = useState<string | null>(null);
  /** `${application id}:${"letter" | "cv"}` of the file currently being fetched/rendered. */
  const [busyFile, setBusyFile] = useState<string | null>(null);

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

  async function runFileAction(key: string, action: FileAction, load: () => Promise<File | null>) {
    setBusyFile(key);
    setError(null);
    try {
      const file = await load();
      if (!file) throw new Error("The file is no longer in Google Drive.");
      if (action === "preview") await openPdfPreview(file);
      else await downloadFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the file.");
    } finally {
      setBusyFile(null);
    }
  }

  function handleCoverLetter(application: Application, action: FileAction) {
    const fileName = `Cover Letter - ${application.company || application.position || "application"}.pdf`;
    void runFileAction(`${application.id}:letter`, action, () =>
      renderCoverLetterPdf(application.coverLetter, fileName),
    );
  }

  function handleAdaptedCv(application: Application, record: AdaptedCvRecord, action: FileAction) {
    void runFileAction(`${application.id}:cv`, action, () => getAdaptedCvFile(record));
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
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{stats.total}</span> unique URLs
            </span>
            <span className="text-xs text-muted-foreground" title={`Averaged over the last ${ROLLING_WINDOW_DAYS} days`}>
              <span className="font-semibold text-foreground">{stats.lastWindow}</span> in last {ROLLING_WINDOW_DAYS} days ·{" "}
              <span className="font-semibold text-foreground">{stats.avgPerDay}</span>/day
            </span>
          </div>
          <SubmissionsTimeline series={stats.series} />
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No job postings tracked yet — run Autofill or generate a cover letter on a posting to save one.
        </p>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 py-2 backdrop-blur">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/60" />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${rows.length} postings by position, company, or URL…`}
              className="h-9 border-foreground/25 bg-muted/40 pl-8 text-sm shadow-sm transition-colors hover:border-foreground/40 focus-visible:border-primary focus-visible:bg-background"
            />
          </div>
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
                      <p className="truncate text-sm font-medium">{row.application.position || "—"}</p>
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
              {row.application && (row.application.coverLetter || row.application.adaptedCv) && (
                <div className="flex flex-wrap gap-1.5">
                  {row.application.coverLetter && (
                    <FileChip
                      label="Cover letter"
                      busy={busyFile === `${row.application.id}:letter`}
                      onAction={(action) => handleCoverLetter(row.application!, action)}
                    />
                  )}
                  {row.application.adaptedCv && (
                    <FileChip
                      label="CV"
                      detail={
                        describeValues(row.application.adaptedCv.values) || row.application.adaptedCv.cvFileName
                      }
                      busy={busyFile === `${row.application.id}:cv`}
                      onAction={(action) => handleAdaptedCv(row.application!, row.application!.adaptedCv!, action)}
                    />
                  )}
                </div>
              )}
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
