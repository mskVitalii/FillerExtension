import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { getAllApplications, setApplicationStatus } from "@/features/applications/repository";
import type { Application, ApplicationStatus } from "@/types/application";

const STATUS_OPTIONS: ApplicationStatus[] = ["draft", "applied", "interview", "rejected", "offer"];

interface ApplicationsListProps {
  onBack: () => void;
}

/** Every application saved to Drive (spec sections 6, 19-20) — a single place to see every job applied to and its status. */
export function ApplicationsList({ onBack }: ApplicationsListProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setApplications(await getAllApplications());
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
      {!loading && !error && applications.length === 0 && (
        <p className="text-sm text-muted-foreground">No applications saved yet — generate a cover letter for a job to save one.</p>
      )}

      <div className="flex flex-col gap-2">
        {applications.map((app) => (
          <Card key={app.id}>
            <CardContent className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{app.position || "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">{app.company || "—"}</p>
                </div>
                {app.url && (
                  <a
                    href={app.url}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    aria-label="Open job posting"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Select
                  className="h-7 w-32 text-xs"
                  value={app.status}
                  onChange={(e) => void handleStatusChange(app, e.target.value as ApplicationStatus)}
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </Select>
                <span className="text-xs text-muted-foreground">
                  {new Date(app.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
