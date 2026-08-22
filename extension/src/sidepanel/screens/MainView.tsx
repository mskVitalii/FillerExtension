import { useEffect, useRef, useState, type DragEvent } from "react";
import { GripVertical, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DraggableValue } from "@/components/DraggableValue";
import { CoverLetterEditor } from "@/components/cover-letter/Editor";
import { EMPTY_JOB, type Job } from "@/types/job";
import type { CvMeta, Profile } from "@/types/profile";
import { sendMessage } from "@/types/messages";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { formatProfileValueForDisplay } from "@/features/profile/format-value";
import { downloadFile, renderCoverLetterPdf } from "@/features/pdf/export";
import { fileToBase64 } from "@/lib/base64";
import { setLocal } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { getTabState, setTabState } from "@/features/storage/session";
import { saveCoverLetterDraft } from "@/features/applications/repository";
import { getCvFile } from "@/features/profile/repository";
import { cn } from "@/lib/utils";

interface MainViewProps {
  tabId: number;
  tabUrl: string;
  profile: Profile;
  cvMeta: CvMeta | null;
  onOpenSettings: () => void;
}

const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_LABELS) as (keyof Profile)[];

/**
 * Main workflow screen (spec section 2) — job → cover letter → autofill,
 * all in one panel. Scoped to a single tab: the parent remounts this (via
 * `key={tabId}`) on every tab switch, and job/cover-letter state is cached
 * per tab in `chrome.storage.session` so switching between two job tabs
 * shows each one's own draft instead of leaking one into the other.
 */
export function MainView({ tabId, tabUrl, profile, cvMeta, onOpenSettings }: MainViewProps) {
  const [job, setJob] = useState<Job>(EMPTY_JOB);
  const [loadingJob, setLoadingJob] = useState(true);
  const [coverLetter, setCoverLetter] = useState("");
  const [generating, setGenerating] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cleanedNotice, setCleanedNotice] = useState<string | null>(null);
  const [driveSaveStatus, setDriveSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasting, setPasting] = useState(false);

  const coverLetterFileRef = useRef<File | null>(null);
  const knownUrlRef = useRef(tabUrl);
  const hasLoadedRef = useRef(false);

  // Initial load for this tab: reuse a cached draft for the same URL, or
  // fetch fresh (this only runs once per mount — the parent remounts the
  // whole component via `key={tabId}` on tab switch).
  useEffect(() => {
    void (async () => {
      const cached = await getTabState(tabId);
      if (cached && cached.url === tabUrl) {
        setJob(cached.job);
        setCoverLetter(cached.coverLetter);
        setLoadingJob(false);
        hasLoadedRef.current = true;
        return;
      }
      await bootstrapJob();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In-tab navigation (e.g. clicking through to a different job posting in
  // the same tab) doesn't remount this component — `tabId` stays the same
  // — so a stale draft for the old URL would otherwise stick around.
  useEffect(() => {
    if (tabUrl === knownUrlRef.current) return;
    knownUrlRef.current = tabUrl;
    setJob(EMPTY_JOB);
    setCoverLetter("");
    setCleanedNotice(null);
    void bootstrapJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabUrl]);

  // Persist this tab's draft so switching away and back restores it.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void setTabState(tabId, { url: tabUrl, job, coverLetter });
  }, [tabId, tabUrl, job, coverLetter]);

  // Keep a PDF rendering of the cover letter ready so dragging it onto the
  // page can carry an actual file, not just plain text — pdf() is async and
  // dragstart must attach data synchronously, so this can't be rendered on
  // demand at drag time.
  useEffect(() => {
    if (!coverLetter) {
      coverLetterFileRef.current = null;
      return;
    }
    const timeout = setTimeout(() => {
      void renderCoverLetterPdf(coverLetter, `Cover Letter - ${job.company || "application"}.pdf`).then(
        (file) => {
          coverLetterFileRef.current = file;
        },
      );
    }, 600);
    return () => clearTimeout(timeout);
  }, [coverLetter, job.company]);

  // Cover letters must live in the user's Drive, not just extension-local
  // storage (spec sections 6, 19-20) — debounced so typing in the editor
  // doesn't fire a Drive write on every keystroke.
  useEffect(() => {
    if (!hasLoadedRef.current || !coverLetter || !job.url) return;
    setDriveSaveStatus("saving");
    const timeout = setTimeout(() => {
      void saveCoverLetterDraft(job, coverLetter)
        .then(() => setDriveSaveStatus("saved"))
        .catch(() => setDriveSaveStatus("error"));
    }, 1500);
    return () => clearTimeout(timeout);
  }, [job, coverLetter]);

  async function bootstrapJob() {
    setLoadingJob(true);
    setError(null);
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job }>({ type: "GET_JOB", tabId });
      if (response?.job) {
        setJob(response.job);
        const prefs = await getPreferences();
        if (prefs.autofillOnOpen) await runAutofill();
      }
    } catch {
      setError("Could not read this page. Open a job posting tab, or paste the job text below.");
    } finally {
      setLoadingJob(false);
      hasLoadedRef.current = true;
    }
  }

  async function handleExtractFromPastedText() {
    if (!pasteText.trim()) return;
    setPasting(true);
    setError(null);
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job }>({
        type: "EXTRACT_JOB_FROM_TEXT",
        tabId,
        text: pasteText,
      });
      if (response?.job) setJob(response.job);
      setPasteMode(false);
      setPasteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that job text.");
    } finally {
      setPasting(false);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setCleanedNotice(null);
    try {
      const response = await sendMessage<{
        type: "COVER_LETTER_RESULT";
        content: string;
        slopFindings: { pattern: string; match: string }[];
        cleaned: boolean;
      }>({ type: "GENERATE_COVER_LETTER", job });
      setCoverLetter(response.content);
      if (response.cleaned) {
        const patterns = Array.from(new Set(response.slopFindings.map((f) => f.pattern))).join(", ");
        setCleanedNotice(`Cleaned up AI-sounding phrasing before showing you this draft (${patterns}).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cover letter generation failed.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleCoverLetterChange(text: string) {
    setCoverLetter(text);
    await setLocal("lastCoverLetter", text);
  }

  async function handleExportPdf() {
    try {
      const file = await renderCoverLetterPdf(coverLetter, `Cover Letter - ${job.company || "application"}.pdf`);
      await downloadFile(file);
    } catch (err) {
      setError(err instanceof Error ? `PDF export failed: ${err.message}` : "PDF export failed.");
    }
  }

  function handleCoverLetterDragStart(e: DragEvent<HTMLDivElement>) {
    if (coverLetterFileRef.current) {
      e.dataTransfer.items.add(coverLetterFileRef.current);
    }
  }

  async function handleUploadCoverLetterToPage() {
    setAutofillStatus(null);
    try {
      const file = await renderCoverLetterPdf(coverLetter, `Cover Letter - ${job.company || "application"}.pdf`);
      const base64Data = await fileToBase64(file);
      const response = await sendMessage<{ type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }>({
        type: "UPLOAD_FILE",
        tabId,
        kind: "coverLetter",
        fileName: file.name,
        mimeType: file.type,
        base64Data,
      });
      setAutofillStatus(
        `Cover letter placed into ${response.nativeInputs} file input(s), ${response.dropZones} drop zone(s).`,
      );
    } catch (err) {
      setAutofillStatus(err instanceof Error ? `PDF export failed: ${err.message}` : "PDF export failed.");
    }
  }

  async function handleUploadCvToPage() {
    setAutofillStatus(null);
    const file = await getCvFile();
    if (!file) {
      setAutofillStatus("Could not load CV from Google Drive.");
      return;
    }
    const base64Data = await fileToBase64(file);
    const response = await sendMessage<{ type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }>({
      type: "UPLOAD_FILE",
      tabId,
      kind: "cv",
      fileName: file.name,
      mimeType: file.type,
      base64Data,
    });
    setAutofillStatus(`CV placed into ${response.nativeInputs} file input(s), ${response.dropZones} drop zone(s).`);
  }

  async function runAutofill() {
    setAutofillStatus(null);
    try {
      const response = await sendMessage<{ type: "AUTOFILL_RESULT"; filled: number; total: number }>({
        type: "AUTOFILL",
        tabId,
        profile,
      });
      setAutofillStatus(`Filled ${response.filled} of ${response.total} detected fields.`);
    } catch {
      setAutofillStatus("Autofill failed on this page.");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Job Application Assistant</h1>
        <button onClick={onOpenSettings} aria-label="Settings">
          <Settings className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-2 text-sm">
        <Field label="Company" value={job.company} loading={loadingJob} />
        <Field label="Position" value={job.position} loading={loadingJob} />
        <Field label="Location" value={job.location} loading={loadingJob} />
      </div>

      <button
        onClick={() => setPasteMode((v) => !v)}
        className="w-fit text-xs text-muted-foreground underline underline-offset-2"
      >
        {pasteMode ? "Cancel" : "Paste job text instead"}
      </button>

      {pasteMode && (
        <div className="flex flex-col gap-2">
          <textarea
            className="min-h-24 rounded-md border border-border bg-background p-2 text-sm outline-none"
            placeholder="Paste the job posting text here…"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <Button size="sm" onClick={handleExtractFromPastedText} disabled={pasting || !pasteText.trim()}>
            {pasting ? "Reading…" : "Use this text"}
          </Button>
        </div>
      )}

      <Button onClick={handleGenerate} disabled={generating || !job.position}>
        {generating ? "Generating…" : "Generate Cover Letter"}
      </Button>

      {coverLetter && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <DraggableValue value={coverLetter} onDragStart={handleCoverLetterDragStart}>
              <p className="text-sm font-medium">Cover Letter</p>
            </DraggableValue>
            <span className="text-xs text-muted-foreground">
              {driveSaveStatus === "saving" && "Saving to Drive…"}
              {driveSaveStatus === "saved" && "Saved to Drive"}
              {driveSaveStatus === "error" && "Drive save failed"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto the page to insert as text, or onto a file
            upload zone to attach the PDF.
          </p>
          {cleanedNotice && <p className="text-xs text-muted-foreground">{cleanedNotice}</p>}
          <CoverLetterEditor content={coverLetter} onChange={handleCoverLetterChange} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
              Regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={handleExportPdf}>
              Export PDF
            </Button>
            <Button size="sm" variant="outline" onClick={handleUploadCoverLetterToPage}>
              Upload to page
            </Button>
          </div>
        </div>
      )}

      <div>
        <p className="text-sm font-medium">Profile</p>
        <p className="text-xs text-muted-foreground">
          <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag any value onto the page to fill a single field.
        </p>
        <ul className="mt-1 flex flex-col divide-y divide-border">
          {PROFILE_FIELDS.map((key) => (
            <li key={key} className="py-1.5">
              <DraggableValue value={profile[key]} className="justify-between gap-3 text-sm">
                <span className="shrink-0 text-muted-foreground">{PROFILE_FIELD_LABELS[key]}</span>
                <span
                  className={cn("truncate text-right", !profile[key] && "text-muted-foreground")}
                  title={profile[key] || undefined}
                >
                  {formatProfileValueForDisplay(key, profile[key]) || "—"}
                </span>
              </DraggableValue>
            </li>
          ))}
        </ul>
      </div>

      <Button onClick={() => void runAutofill()}>Autofill Application</Button>
      {cvMeta && (
        <Button variant="outline" onClick={handleUploadCvToPage}>
          Upload CV
        </Button>
      )}
      {autofillStatus && <p className="text-xs text-muted-foreground">{autofillStatus}</p>}
    </div>
  );
}

function Field({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{loading ? "Loading…" : value || "—"}</p>
    </div>
  );
}
