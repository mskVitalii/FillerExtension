import { useEffect, useRef, useState, type DragEvent } from "react";
import { GripVertical, ListChecks, RotateCcw, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { DraggableValue } from "@/components/DraggableValue";
import { CoverLetterEditor } from "@/components/cover-letter/Editor";
import { EMPTY_JOB, type Job, type JobLanguageInfo } from "@/types/job";
import type { CustomField, CvMeta, LanguageLevel, Profile } from "@/types/profile";
import { meetsLevel } from "@/lib/language-level";
import { sendMessage } from "@/types/messages";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { formatProfileValueForDisplay } from "@/features/profile/format-value";
import { downloadFile, renderCoverLetterPdf } from "@/features/pdf/export";
import { fileToBase64 } from "@/lib/base64";
import { setLocal } from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { clearTabState, getTabState, setTabState } from "@/features/storage/session";
import { saveCoverLetterDraft } from "@/features/applications/repository";
import { getCvFile } from "@/features/profile/repository";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import { LANGUAGES } from "@/lib/languages";
import { cn } from "@/lib/utils";

interface MainViewProps {
  tabId: number;
  tabUrl: string;
  profile: Profile;
  cvMeta: CvMeta | null;
  customFields: CustomField[];
  languageLevels: LanguageLevel[];
  hasApiKey: boolean;
  googleConnected: boolean;
  onOpenSettings: () => void;
  onOpenApplications: () => void;
  onRequestApiKey: () => void;
  onRequestGoogleConnect: () => void;
}

const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_LABELS) as (keyof Profile)[];
type CoverLetterTab = "draft" | "translate";

/**
 * Main workflow screen (spec section 2) — job → cover letter → autofill,
 * all in one panel. Scoped to a single tab: the parent remounts this (via
 * `key={tabId}`) on every tab switch, and job/cover-letter state is cached
 * per tab in `chrome.storage.session` so switching between two job tabs
 * shows each one's own draft instead of leaking one into the other.
 */
export function MainView({
  tabId,
  tabUrl,
  profile,
  cvMeta,
  customFields,
  languageLevels,
  hasApiKey,
  googleConnected,
  onOpenSettings,
  onOpenApplications,
  onRequestApiKey,
  onRequestGoogleConnect,
}: MainViewProps) {
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

  const [coverLetterTab, setCoverLetterTab] = useState<CoverLetterTab>("draft");
  const [improveInstructions, setImproveInstructions] = useState("");
  const [improving, setImproving] = useState(false);
  const [translateLanguage, setTranslateLanguage] = useState("Russian");
  const [translation, setTranslation] = useState<{ language: string; content: string } | null>(null);
  const [translating, setTranslating] = useState(false);

  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [answeringQuestion, setAnsweringQuestion] = useState<string | null>(null);
  const [detectingQuestions, setDetectingQuestions] = useState(false);

  const [showJobText, setShowJobText] = useState(false);
  const [jobLanguage, setJobLanguage] = useState<JobLanguageInfo | null>(null);

  const coverLetterFileRef = useRef<File | null>(null);
  const knownUrlRef = useRef(tabUrl);
  const hasLoadedRef = useRef(false);

  // Seeds the Translate tab's language selector from the remembered
  // preference (spec_2 item 3) — independent of per-tab cache restore below.
  useEffect(() => {
    void getPreferences().then((prefs) => setTranslateLanguage(prefs.translateLanguage));
  }, []);

  // Initial load for this tab: reuse a cached draft for the same URL, or
  // fetch fresh (this only runs once per mount — the parent remounts the
  // whole component via `key={tabId}` on tab switch).
  useEffect(() => {
    void (async () => {
      const cached = await getTabState(tabId);
      if (cached && cached.url === tabUrl) {
        setJob(cached.job);
        setCoverLetter(cached.coverLetter);
        setPasteMode(cached.pasteMode);
        setPasteText(cached.pasteText);
        setTranslation(cached.translation);
        setCustomQuestions(cached.customQuestions);
        setQuestionAnswers(cached.customQuestionAnswers);
        setJobLanguage(cached.jobLanguage);
        setLoadingJob(false);
        hasLoadedRef.current = true;
        return;
      }
      await bootstrapJob();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // In-tab navigation doesn't remount this component — `tabId` stays the
  // same — so without this a stale draft for the old URL would stick
  // around. But navigation is also how many sites move from a job's
  // description page to that same job's application form (e.g. clicking
  // "Apply"), and that next page frequently has no extractable job data of
  // its own. Only replace the current draft when the new page actually
  // yields a *different* job; otherwise treat it as still the same
  // application and keep what's already there (the user can always clear it
  // with the Reset button).
  useEffect(() => {
    if (tabUrl === knownUrlRef.current) return;
    knownUrlRef.current = tabUrl;
    void handleNavigation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabUrl]);

  async function handleNavigation() {
    let newJob: Job | undefined;
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job }>({ type: "GET_JOB", tabId });
      newJob = response?.job;
    } catch {
      // No content script on the new page (e.g. a chrome:// page reached mid-flow) — keep the current draft.
    }

    const isDifferentJob =
      Boolean(newJob?.position) && (newJob?.position !== job.position || newJob?.company !== job.company);

    if (newJob && isDifferentJob) {
      setError(null);
      setJob(newJob);
      setCoverLetter("");
      setCleanedNotice(null);
      setTranslation(null);
      setCustomQuestions([]);
      setQuestionAnswers({});
      setJobLanguage(null);
      void handleDetectJobLanguage(newJob);
      const prefs = await getPreferences();
      if (prefs.autofillOnOpen) await runAutofill();
    }
    void handleDetectQuestions();
  }

  async function handleReset() {
    await clearTabState(tabId);
    setJob(EMPTY_JOB);
    setCoverLetter("");
    setCleanedNotice(null);
    setTranslation(null);
    setCustomQuestions([]);
    setQuestionAnswers({});
    setJobLanguage(null);
    setPasteMode(false);
    setPasteText("");
    setError(null);
    setAutofillStatus(null);
    void bootstrapJob();
  }

  // Persist this tab's content so switching away and back restores it
  // (spec_2 item 2) — covers everything a user would consider "what I was
  // doing", not just the draft itself.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    void setTabState(tabId, {
      url: tabUrl,
      job,
      coverLetter,
      pasteMode,
      pasteText,
      translation,
      customQuestions,
      customQuestionAnswers: questionAnswers,
      jobLanguage,
    });
  }, [
    tabId,
    tabUrl,
    job,
    coverLetter,
    pasteMode,
    pasteText,
    translation,
    customQuestions,
    questionAnswers,
    jobLanguage,
  ]);

  // Keeps the Translate tab "always on" (spec_2 item 3): re-translates
  // whenever the draft or the chosen language changes, so the user never has
  // to manually re-trigger it after the first time.
  useEffect(() => {
    if (!hasLoadedRef.current || !coverLetter) return;
    const timeout = setTimeout(() => {
      setTranslating(true);
      void sendMessage<{ type: "TRANSLATE_COVER_LETTER_RESULT"; content: string }>({
        type: "TRANSLATE_COVER_LETTER",
        content: coverLetter,
        targetLanguage: translateLanguage,
      })
        .then((response) => setTranslation({ language: translateLanguage, content: response.content }))
        .catch(() => {
          // Leave the previous translation in place rather than clearing it on a transient failure.
        })
        .finally(() => setTranslating(false));
    }, 1500);
    return () => clearTimeout(timeout);
  }, [coverLetter, translateLanguage]);

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
      void saveCoverLetterDraft(job, coverLetter, translation)
        .then(() => setDriveSaveStatus("saved"))
        .catch(() => setDriveSaveStatus("error"));
    }, 1500);
    return () => clearTimeout(timeout);
  }, [job, coverLetter, translation]);

  async function bootstrapJob() {
    setLoadingJob(true);
    setError(null);
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job }>({ type: "GET_JOB", tabId });
      if (response?.job) {
        setJob(response.job);
        void handleDetectJobLanguage(response.job);
        const prefs = await getPreferences();
        if (prefs.autofillOnOpen) await runAutofill();
      }
    } catch {
      setError("Could not read this page. Open a job posting tab, or paste the job text below.");
    } finally {
      setLoadingJob(false);
      hasLoadedRef.current = true;
    }
    void handleDetectQuestions();
  }

  async function handleDetectJobLanguage(currentJob: Job) {
    try {
      const response = await sendMessage<{ type: "JOB_LANGUAGE_DATA"; info: JobLanguageInfo }>({
        type: "DETECT_JOB_LANGUAGE",
        job: currentJob,
      });
      setJobLanguage(response?.info ?? null);
    } catch {
      // No API key yet, or the request failed — leave the brief without a language badge.
    }
  }

  async function handleDetectQuestions() {
    setDetectingQuestions(true);
    try {
      const response = await sendMessage<{ type: "CUSTOM_QUESTIONS_DATA"; questions: CustomQuestion[] }>({
        type: "DETECT_CUSTOM_QUESTIONS",
        tabId,
      });
      setCustomQuestions(response?.questions ?? []);
    } catch {
      // No content script on this page (e.g. a chrome:// tab) — nothing to detect.
    } finally {
      setDetectingQuestions(false);
    }
  }

  async function handleAnswerQuestion(question: string) {
    setAnsweringQuestion(question);
    try {
      const response = await sendMessage<{ type: "CUSTOM_QUESTION_ANSWER"; question: string; answer: string }>({
        type: "ANSWER_CUSTOM_QUESTION",
        question,
        job,
      });
      setQuestionAnswers((answers) => ({ ...answers, [question]: response.answer }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate an answer for that question.");
    } finally {
      setAnsweringQuestion(null);
    }
  }

  async function handleImprove() {
    if (!improveInstructions.trim()) return;
    setImproving(true);
    setError(null);
    try {
      const response = await sendMessage<{ type: "REVISE_COVER_LETTER_RESULT"; content: string }>({
        type: "REVISE_COVER_LETTER",
        job,
        content: coverLetter,
        instructions: improveInstructions,
      });
      await handleCoverLetterChange(response.content);
      setImproveInstructions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not improve the cover letter.");
    } finally {
      setImproving(false);
    }
  }

  async function handleTranslateLanguageChange(language: string) {
    setTranslateLanguage(language);
    await setPreferences({ translateLanguage: language });
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
      if (response?.job) {
        setJob(response.job);
        void handleDetectJobLanguage(response.job);
      }
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
        <h1 className="text-base font-semibold">Filler</h1>
        <div className="flex items-center gap-3">
          <button onClick={() => void handleReset()} aria-label="Reset">
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </button>
          <button onClick={onOpenApplications} aria-label="Applications">
            <ListChecks className="h-4 w-4 text-muted-foreground" />
          </button>
          <button onClick={onOpenSettings} aria-label="Settings">
            <Settings className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {!hasApiKey && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Extraction works without it, but generating a cover letter needs your OpenAI key —{" "}
          <button onClick={onRequestApiKey} className="underline underline-offset-2">
            add it
          </button>
          .
        </p>
      )}
      {hasApiKey && !googleConnected && (
        <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
          Connect Google Drive to save your profile, CV and cover letters —{" "}
          <button onClick={onRequestGoogleConnect} className="underline underline-offset-2">
            connect
          </button>
          .
        </p>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-1 gap-2 text-sm">
        <Field label="Company" value={job.company} loading={loadingJob} />
        <Field label="Position" value={job.position} loading={loadingJob} />
        <Field label="Location" value={job.location} loading={loadingJob} />
      </div>

      {jobLanguage && (jobLanguage.postingLanguages.length > 0 || jobLanguage.requirements.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {jobLanguage.postingLanguages.length > 0 && (
            <span className="text-muted-foreground">Posting language: {jobLanguage.postingLanguages.join(", ")}</span>
          )}
          {jobLanguage.requirements.map((req) => {
            const ownLevel = languageLevels.find(
              (l) => l.language.toLowerCase() === req.language.toLowerCase(),
            )?.level;
            const match = req.level && ownLevel ? meetsLevel(req.level, ownLevel) : null;
            return (
              <span
                key={req.language}
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium",
                  match === true && "bg-emerald-100 text-emerald-700",
                  match === false && "bg-red-100 text-red-700",
                  match === null && "bg-muted text-muted-foreground",
                )}
              >
                {req.language} {req.level ?? "level required"}
              </span>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setShowJobText((v) => !v)}
        className="w-fit text-xs text-muted-foreground underline underline-offset-2"
      >
        {showJobText ? "Hide job text" : "Show job text"}
      </button>

      {showJobText && (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <p className="text-xs text-muted-foreground">
            This is the text that's sent to the AI — edit or paste over it if the extraction got
            something wrong before generating.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Description</label>
            <textarea
              className="min-h-24 rounded-md border border-border bg-background p-2 text-sm outline-none"
              value={job.description}
              onChange={(e) => setJob((j) => ({ ...j, description: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Requirements (one per line)</label>
            <textarea
              className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
              value={job.requirements.join("\n")}
              onChange={(e) =>
                setJob((j) => ({
                  ...j,
                  requirements: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
                }))
              }
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Responsibilities (one per line)</label>
            <textarea
              className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
              value={job.responsibilities.join("\n")}
              onChange={(e) =>
                setJob((j) => ({
                  ...j,
                  responsibilities: e.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
                }))
              }
            />
          </div>
        </div>
      )}

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

          <div className="flex gap-1 border-b border-border text-sm">
            <button
              onClick={() => setCoverLetterTab("draft")}
              className={cn(
                "px-2 py-1 -mb-px border-b-2",
                coverLetterTab === "draft" ? "border-primary font-medium" : "border-transparent text-muted-foreground",
              )}
            >
              Draft
            </button>
            <button
              onClick={() => setCoverLetterTab("translate")}
              className={cn(
                "px-2 py-1 -mb-px border-b-2",
                coverLetterTab === "translate"
                  ? "border-primary font-medium"
                  : "border-transparent text-muted-foreground",
              )}
            >
              Translate{translating && "…"}
            </button>
          </div>

          {coverLetterTab === "draft" ? (
            <>
              <p className="text-xs text-muted-foreground">
                <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto the page to insert as text, or onto a
                file upload zone to attach the PDF.
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
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                <p className="text-xs font-medium">Improve</p>
                <textarea
                  className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
                  placeholder="What should change? e.g. 'make it shorter', 'emphasize the Kubernetes work'…"
                  value={improveInstructions}
                  onChange={(e) => setImproveInstructions(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleImprove}
                  disabled={improving || !improveInstructions.trim()}
                >
                  {improving ? "Improving…" : "Apply"}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              <Select value={translateLanguage} onChange={(e) => void handleTranslateLanguageChange(e.target.value)}>
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </Select>
              {translation ? (
                <>
                  <DraggableValue value={translation.content}>
                    <p className="text-xs text-muted-foreground">Drag onto the page to insert as text.</p>
                  </DraggableValue>
                  <CoverLetterEditor
                    content={translation.content}
                    onChange={(text) => setTranslation({ language: translateLanguage, content: text })}
                  />
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translating ? "Translating…" : "Translation will appear here shortly."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {customQuestions.length > 0 && (
        <div>
          <p className="text-sm font-medium">Application Questions</p>
          <p className="text-xs text-muted-foreground">
            Detected on this page — generate an answer, then drag it onto the field.
          </p>
          <ul className="mt-1 flex flex-col gap-2">
            {customQuestions.map(({ id, question }) => (
              <li key={id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                <p className="text-sm">{question}</p>
                {questionAnswers[question] ? (
                  <DraggableValue value={questionAnswers[question]} className="text-sm text-muted-foreground">
                    <span>{questionAnswers[question]}</span>
                  </DraggableValue>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => void handleAnswerQuestion(question)}
                    disabled={answeringQuestion === question}
                  >
                    {answeringQuestion === question ? "Generating…" : "Generate answer"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detectingQuestions && <p className="text-xs text-muted-foreground">Scanning page for questions…</p>}

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

      {customFields.length > 0 && (
        <div>
          <p className="text-sm font-medium">Custom Fields</p>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto the page — not filled by Autofill
            Application.
          </p>
          <ul className="mt-1 flex flex-col divide-y divide-border">
            {customFields.map((field) => (
              <li key={field.id} className="py-1.5">
                <DraggableValue value={field.value} className="justify-between gap-3 text-sm">
                  <span className="shrink-0 text-muted-foreground">{field.label}</span>
                  <span className={cn("truncate text-right", !field.value && "text-muted-foreground")} title={field.value || undefined}>
                    {field.value || "—"}
                  </span>
                </DraggableValue>
              </li>
            ))}
          </ul>
        </div>
      )}

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
