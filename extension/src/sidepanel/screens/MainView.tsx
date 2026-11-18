import { useEffect, useRef, useState, Suspense, lazy, type DragEvent } from "react";
import { PICKER_GRADIENT } from "@/lib/brand-gradient";
import { CheckCircle2, Download, Eye, FileText, FileUser, GripVertical, ListChecks, Loader2, Mail, Paperclip, Pencil, RotateCcw, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DraggableValue } from "@/components/DraggableValue";
import { PinHint } from "@/components/PinHint";
import { SetupBanner } from "@/components/SetupBanner";
import { FrameAccessBanner } from "@/components/FrameAccessBanner";
import { TabAccessBanner } from "@/components/TabAccessBanner";
import { useToolbarPinned } from "../hooks/useToolbarPinned";
import { useCvChoice } from "../hooks/useCvChoice";
import { useI18n, useT } from "@/i18n/react";
import { CvChoiceLine } from "@/components/CvChoiceLine";
// TipTap + ProseMirror (~200 kB) load only once a cover letter exists and
// the editor actually renders — kept out of the Side Panel's initial bundle.
const CoverLetterEditor = lazy(() =>
  import("@/components/cover-letter/Editor").then((m) => ({ default: m.CoverLetterEditor })),
);
const EditorFallback = () => <p className="text-xs text-muted-foreground">{useT()("main.loadingEditor")}</p>;
import { EMPTY_JOB, type Job, type JobBrief, type JobKeyword, type JobLanguageInfo } from "@/types/job";
import type { CustomField, CvMeta, LanguageLevel, Profile } from "@/types/profile";
import { meetsLevel } from "@/lib/language-level";
import { sendMessage, type MessageOf, type RuntimeMessage } from "@/types/messages";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { formatProfileValueForDisplay } from "@/features/profile/format-value";
import { downloadFile, openPdfPreview, renderCoverLetterPdf } from "@/features/pdf/export";
import { fileToBase64 } from "@/lib/base64";
import { getWorkStart, recordUrlActivation, recordWorkStart, setCachedJob, setLocal } from "@/features/storage/local";
import { keepUserEdits } from "@/features/job-extraction/completion";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import {
  clearTabState,
  coverLetterRunKey,
  getCoverLetterRun,
  getTabState,
  setCoverLetterRun,
  setTabState,
  type CoverLetterRun,
} from "@/features/storage/session";
import { getApplicationByUrl, markJobApplied, saveCoverLetterDraft } from "@/features/applications/repository";
import { formatDuration } from "@/features/applications/day-timeline";
import type { Application } from "@/types/application";
import { getCvAttachmentFile } from "@/features/profile/repository";
import { LATEX_COMPILE_HOST } from "@/features/cv-template/latex";
import type { CvTemplate } from "@/types/cv-template";
import { getCvTemplates, templateForCv } from "@/features/cv-template/repository";
import {
  loadAdaptEntry,
  recordAdaptedCv,
  renderAdaptedCv,
  resolveValues,
  saveAdaptEntry,
  suggestEntry,
  usedVariables,
} from "@/features/cv-template/adapt";
import { questionAnswerKey, type CustomQuestion } from "@/features/autofill/custom-questions";
import type { PickedField } from "@/features/autofill/pick-questions";
import type { ElementLocator } from "@/features/autofill/element-locator";
import type { PageCheckbox } from "@/features/autofill/checkboxes";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import { hasChoiceOptions } from "@/features/openai/question-decisions";
import { LANGUAGES } from "@/lib/languages";
import { generatePassword } from "@/lib/generate-password";
import { cn } from "@/lib/utils";
import { isEmailAddress } from "@/lib/email";
import { AgentApplyButton } from "@/components/AgentApplyButton";

/**
 * Toggles "Pick fields on page" from the keyboard while the Side Panel is
 * focused — press once to start, again to stop. Alt+P has no default action
 * in the panel and `preventDefault` stops it typing a character.
 */
const PICKER_HOTKEY_LABEL =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌥P" : "Alt+P";

/** Kept identical to the gradient `element-picker.ts` draws around a picked block on the page. */

/** Matches a bare email address (not a full RFC grammar) — just enough to tell `job.contact` apart from a LinkedIn URL for the outreach-message "open" action. */

/** Appends `contact` to the keyword-highlight list sent to the page, reusing the same green
 * "match" styling (`features/highlight/keyword-highlight.ts`) — it's not a skill match, but it's
 * the same "notable, worth a glance" treatment, and introducing a third highlight color for one
 * extra string isn't worth it. */
function withContactHighlight(keywords: JobKeyword[], contact: string | null): JobKeyword[] {
  return contact ? [...keywords, { text: contact, matchesProfile: true }] : keywords;
}

interface MainViewProps {
  tabId: number;
  tabUrl: string;
  /** False while this tab's view is kept mounted in the background (another tab or screen is shown). */
  active: boolean;
  profile: Profile;
  cvMeta: CvMeta | null;
  customFields: CustomField[];
  languageLevels: LanguageLevel[];
  hasApiKey: boolean;
  googleConnected: boolean;
  onOpenSettings: () => void;
  onOpenApplications: () => void;
  onOpenJobSearch: () => void;
  onOpenCvAdapt: () => void;
  onRequestApiKey: () => void;
  onRequestGoogleConnect: () => void;
  /** The posting's CV was picked automatically or by hand here — it becomes the active CV. */
  onCvChange: (cv: CvMeta) => void;
}

const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_LABELS) as (keyof Profile)[];
type CoverLetterTab = "draft" | "translate";

/**
 * Main workflow screen (spec section 2) — job → cover letter → autofill,
 * all in one panel. Scoped to a single tab: the parent keeps one instance per
 * visited tab mounted (hidden while `active` is false), so work in flight on
 * one tab keeps going while the user is on another. Job/cover-letter state is
 * also cached per tab in `chrome.storage.session`, so a view that was dropped
 * (tab limit, panel reopened) restores its draft.
 */
export function MainView({
  tabId,
  tabUrl,
  active,
  profile,
  cvMeta,
  customFields,
  languageLevels,
  hasApiKey,
  googleConnected,
  onOpenSettings,
  onOpenApplications,
  onOpenJobSearch,
  onOpenCvAdapt,
  onRequestApiKey,
  onRequestGoogleConnect,
  onCvChange,
}: MainViewProps) {
  // Gates every AI-only and Drive-only section of the panel (spec_8): with
  // either missing, cover letters/auto-answers/keyword highlighting/job
  // search/saved applications can't work, so hiding them instead of letting
  // them silently error keeps the panel down to what actually works —
  // extraction + Autofill Application, neither of which needs either.
  const setupComplete = hasApiKey && googleConnected;
  const { t, locale } = useI18n();
  const toolbarPinned = useToolbarPinned();
  const [job, setJob] = useState<Job>(EMPTY_JOB);
  const [loadingJob, setLoadingJob] = useState(true);
  // spec_7 item 8 — a previously-saved Drive record for the current job URL,
  // surfaced as a badge so re-opening a posting already applied to is
  // obvious before generating a duplicate cover letter.
  const [existingApplication, setExistingApplication] = useState<Application | null>(null);
  const [markingApplied, setMarkingApplied] = useState(false);
  const [coverLetter, setCoverLetter] = useState("");
  const [generating, setGenerating] = useState(false);
  const [outreachMessage, setOutreachMessage] = useState<{ subject: string | null; body: string } | null>(null);
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [outreachCopied, setOutreachCopied] = useState(false);
  const [outreachImproveInstructions, setOutreachImproveInstructions] = useState("");
  const [improvingOutreach, setImprovingOutreach] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<string | null>(null);
  const [autofilling, setAutofilling] = useState(false);
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
  // One entry per language in "My Languages" (Settings) plus whatever the
  // dropdown below is set to — translated in parallel, keyed by language
  // name, so switching between tabs never re-triggers a request for a
  // translation already generated.
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [activeTranslationLanguage, setActiveTranslationLanguage] = useState("");
  const [translatingLanguages, setTranslatingLanguages] = useState<Set<string>>(new Set());

  const [customQuestions, setCustomQuestions] = useState<CustomQuestion[]>([]);
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [answeringAllQuestions, setAnsweringAllQuestions] = useState(false);
  // spec_7 item 12 — a manual fallback for when the picker/automatic
  // detection can't find a question on the page: typed by hand, answered the
  // same way, then copy/pasted since there's no page element to target.
  const [manualQuestionText, setManualQuestionText] = useState("");
  const [addingManualQuestion, setAddingManualQuestion] = useState(false);
  const [detectingQuestions, setDetectingQuestions] = useState(false);
  const [picking, setPicking] = useState(false);
  // Questions the AI answered but whose field refused every autofill attempt
  // (e.g. a react-select combobox that only opens on a real trusted click,
  // which a content script can't fabricate — see combobox.ts) — surfaced so
  // the user knows to answer these by hand instead of assuming they're done.
  const [unfillableQuestions, setUnfillableQuestions] = useState<string[]>([]);
  // Keyed by `questionAnswerKey` — questions the model reported it couldn't
  // answer for lack of profile/CV/etc information (spec_8 item 6), shown as
  // a distinct "not enough info" badge instead of the generic "no answer
  // yet" placeholder. Nothing about this is written onto the page itself.
  const [insufficientInfoQuestions, setInsufficientInfoQuestions] = useState<Set<string>>(new Set());
  // Not rendered in the UI (spec: checkboxes are decided and ticked directly
  // on the page — the applicant reviews/changes them there like any other
  // field), but still persisted to the per-tab cache so a re-open doesn't
  // re-run `handleAnalyzePageContent` needlessly.
  const [checkboxDecisions, setCheckboxDecisions] = useState<CheckboxDecision[]>([]);

  const [showJobText, setShowJobText] = useState(false);
  const [jobLanguage, setJobLanguage] = useState<JobLanguageInfo | null>(null);
  const [jobKeywords, setJobKeywords] = useState<JobKeyword[]>([]);
  // Language/keyword/contact analysis in flight (handleDetectJobBrief) — distinct from
  // `loadingJob` (the extraction itself), since this runs as its own request right after.
  const [briefLoading, setBriefLoading] = useState(false);
  // The AI pass filling what a DOM-insufficient extraction missed (completeJobInBackground) —
  // the DOM result is already on screen while it runs.
  const [completingJob, setCompletingJob] = useState(false);
  // The combined checkbox-decision + question-answer call (handleAnalyzePageContent) in flight.
  const [decidingPageContent, setDecidingPageContent] = useState(false);
  // On by default (spec_8 item 2: "make reading the posting cooler") — the
  // toggle just lets the user turn it back off if they don't like it, or
  // re-run it after `handleReset`.
  const [highlightOnPage, setHighlightOnPage] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  // The page couldn't be read because Filler has no access to this tab yet: it was switched to
  // with the panel already open, so no toolbar click granted activeTab here.
  const [needsTabAccess, setNeedsTabAccess] = useState(false);
  const needsTabAccessRef = useRef(needsTabAccess);
  needsTabAccessRef.current = needsTabAccess;
  const activeRef = useRef(active);
  activeRef.current = active;
  /** This panel sent the GENERATE_COVER_LETTER in flight and gets its answer directly. */
  const ownRunRef = useRef(false);
  /** Following a generation another (unloaded) instance of this panel started — via session storage. */
  const resumedRunRef = useRef(false);
  const [passwordCopied, setPasswordCopied] = useState(false);

  const coverLetterFileRef = useRef<File | null>(null);
  const cvFileRef = useRef<File | null>(null);
  const knownUrlRef = useRef(tabUrl);
  const hasLoadedRef = useRef(false);
  /** Position/company as extracted, before a manual correction — see `TabState.extractedPosition`. */
  const extractedJobRef = useRef({ position: "", company: "" });
  /** The job on screen right now, for merging a background completion without a stale closure. */
  const jobRef = useRef(job);
  jobRef.current = job;
  // Picker mode is a loop, not a one-shot: `pickingRef` gates the loop and
  // `pickerPortRef` is a disconnect-on-close channel to the background.
  const pickingRef = useRef(false);
  const pickerPortRef = useRef<chrome.runtime.Port | null>(null);
  // Locator tags of picker-added questions already ingested. The picker loop
  // needs a *synchronous* dedup: `setCustomQuestions`'s functional updater
  // runs too late (React 18 flushes it after this async tick), so its result
  // can't gate whether we answer a freshly picked field.
  const ingestedTagsRef = useRef<Set<string>>(new Set());

  // Mirrors *Ref.current as actual state so the UI can tell "not draggable
  // yet" apart from "draggable" — a plain ref wouldn't re-render the icon.
  // This turned out to matter a lot: if `draggable` is left on while the
  // file hasn't loaded yet, dragstart fires with nothing to attach, and the
  // browser silently falls back to dragging the element's own *text*
  // (its visible label) instead of doing nothing — which is exactly why a
  // premature drag looked like it "worked" but dropped a filename as plain
  // text (e.g. into ChatGPT's composer) instead of a file, while a page
  // that expects only files (e.g. css-tricks' demo) just got nothing.
  const [cvFileReady, setCvFileReady] = useState(false);
  /** The active CV's Adapt CV template, when it has placeholders — gates the "adapted CV" buttons. */
  const [adaptTemplate, setAdaptTemplate] = useState<CvTemplate | null>(null);
  const [adaptingCv, setAdaptingCv] = useState(false);
  const [adaptStatus, setAdaptStatus] = useState<string | null>(null);
  const [coverLetterFileReady, setCoverLetterFileReady] = useState(false);

  // Keeps a real File ready for native drag-and-drop (see handleCvDragStart)
  // — dragstart must attach dataTransfer synchronously, and getCvAttachmentFile() is
  // async (Drive round-trip), so it can't be fetched on demand at drag time.
  useEffect(() => {
    if (!cvMeta) {
      cvFileRef.current = null;
      setCvFileReady(false);
      return;
    }
    setCvFileReady(false);
    void getCvAttachmentFile()
      .then((file) => {
        cvFileRef.current = file;
        setCvFileReady(Boolean(file));
      })
      .catch(() => setCvFileReady(false));
  }, [cvMeta]);

  useEffect(() => {
    if (!cvMeta) {
      setAdaptTemplate(null);
      return;
    }
    let cancelled = false;
    void getCvTemplates().then((library) => {
      if (cancelled) return;
      const template = templateForCv(cvMeta, library);
      setAdaptTemplate(usedVariables(template).length > 0 ? template : null);
    });
    return () => {
      cancelled = true;
    };
  }, [cvMeta]);

  // Seeds the Translate tab's language selector from the remembered
  // preference (spec_2 item 3) — independent of per-tab cache restore below.
  useEffect(() => {
    void getPreferences().then((prefs) => setTranslateLanguage(prefs.translateLanguage));
  }, []);

  // Initial load for this tab: reuse a cached draft for the same URL, or
  // fetch fresh (this only runs once per mount — the panel is bound to one tab).
  useEffect(() => {
    void (async () => {
      const cached = await getTabState(tabId);
      if (cached && cached.url === tabUrl) {
        extractedJobRef.current = {
          position: cached.extractedPosition ?? cached.job.position,
          company: cached.extractedCompany ?? cached.job.company,
        };
        setJob(cached.job);
        setCoverLetter(cached.coverLetter);
        setOutreachMessage(cached.outreachMessage ?? null);
        setPasteMode(cached.pasteMode);
        setPasteText(cached.pasteText);
        setTranslations(cached.translations);
        setActiveTranslationLanguage(cached.activeTranslationLanguage);
        setCustomQuestions(cached.customQuestions);
        ingestedTagsRef.current = new Set(
          cached.customQuestions.map((q) => q.locator?.tag).filter((t): t is string => Boolean(t)),
        );
        setQuestionAnswers(cached.customQuestionAnswers);
        setCheckboxDecisions(cached.checkboxDecisions ?? []);
        setJobLanguage(cached.jobLanguage);
        void checkExistingApplication(cached.job.url);
        setLoadingJob(false);
        hasLoadedRef.current = true;
        await resumeCoverLetterRun(cached.job.url);
        // A password is always ready to drag/copy by default — no reason to
        // make the user click a button first. Only generate one here if
        // this tab genuinely never had one yet; a cached one is restored as-is.
        if (cached.generatedPassword) {
          setGeneratedPassword(cached.generatedPassword);
        } else {
          await handleGeneratedPassword(generatePassword());
        }
        return;
      }
      await bootstrapJob();
      await handleGeneratedPassword(generatePassword());
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

  /** An http(s) page this extension has no host permission for — only an icon click (activeTab) would open it. */
  async function lacksTabAccess(): Promise<boolean> {
    let origin: string;
    try {
      const url = new URL(tabUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
      origin = url.origin;
    } catch {
      return false;
    }
    return !(await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false));
  }

  /** Runs in the banner's click handler: `permissions.request` needs that user gesture. */
  async function handleGrantTabAccess(allSites: boolean) {
    let origins: string[];
    if (allSites) {
      origins = ["https://*/*", "http://*/*"];
    } else {
      try {
        origins = [`${new URL(tabUrl).origin}/*`];
      } catch {
        return;
      }
    }
    const granted = await chrome.permissions.request({ origins }).catch(() => false);
    if (granted) await bootstrapJob(true);
  }

  // A toolbar-icon click on this tab while the panel was already open grants access: retry.
  useEffect(() => {
    function onAccessGranted(message: RuntimeMessage) {
      if (message.type !== "TAB_ACCESS_GRANTED" || message.tabId !== tabId) return;
      if (needsTabAccessRef.current || !jobRef.current.position) void bootstrapJob();
    }
    chrome.runtime.onMessage.addListener(onAccessGranted);
    return () => chrome.runtime.onMessage.removeListener(onAccessGranted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);
  // Coming back to a tab that couldn't be read: access may have been granted meanwhile (all sites
  // allowed from another tab's banner), so try again instead of showing the stale prompt.
  useEffect(() => {
    if (active && needsTabAccessRef.current) void bootstrapJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Moving to another tab ends picker mode here — the overlay would otherwise keep waiting on a
  // page the user is no longer looking at.
  useEffect(() => {
    if (!active && pickingRef.current) handleStopPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleNavigation() {
    let newJob: Job | undefined;
    let newBrief: JobBrief | undefined;
    let incomplete: MessageOf<"JOB_DATA"> | undefined;
    try {
      const response = await sendMessage<MessageOf<"JOB_DATA"> | undefined>({ type: "GET_JOB", tabId });
      newJob = response?.job;
      newBrief = response?.brief;
      if (response && !response.sufficient) incomplete = response;
    } catch {
      // No content script on the new page (e.g. a chrome:// page reached mid-flow) — keep the current draft.
    }

    // Compared against both the (possibly hand-corrected) current title/company and what extraction
    // originally found: the next page of the same posting re-extracts the original, while a URL whose
    // cached job already carries the correction returns that — neither is a different job.
    const isDifferentJob =
      Boolean(newJob?.position) &&
      ((newJob?.position !== job.position && newJob?.position !== extractedJobRef.current.position) ||
        (newJob?.company !== job.company && newJob?.company !== extractedJobRef.current.company));

    if (newJob && isDifferentJob) {
      setError(null);
      extractedJobRef.current = { position: newJob.position, company: newJob.company };
      setJob(newJob);
      setCoverLetter("");
      setOutreachMessage(null);
      setOutreachError(null);
      setOutreachImproveInstructions("");
      setCleanedNotice(null);
      setTranslations({});
      setActiveTranslationLanguage("");
      setCustomQuestions([]);
      ingestedTagsRef.current.clear();
      setQuestionAnswers({});
      setInsufficientInfoQuestions(new Set());
      setCheckboxDecisions([]);
      setJobLanguage(null);
      setJobKeywords([]);
      void sendMessage({ type: "CLEAR_KEYWORD_HIGHLIGHTS", tabId }).catch(() => undefined);
      if (newBrief) void applyJobBrief(newJob, newBrief);
      else if (!incomplete) void handleDetectJobBrief(newJob);
      void checkExistingApplication(newJob.url);
      const prefs = await getPreferences();
      if (prefs.autofillOnOpen) await runAutofill();
      if (incomplete) {
        void completeJobInBackground(incomplete).then((completed) => handleAnalyzePageContent(completed));
        return;
      }
    }
    void handleAnalyzePageContent(newJob ?? job);
  }

  /**
   * A hand-corrected position/company/location is saved into the URL-keyed
   * extraction cache too, so reopening this posting later (new tab, restart)
   * shows the fix instead of re-deriving the wrong one. Everything else that
   * reads the posting — cover letter, answers, Adapt CV, the saved
   * application — already reads `job`, which `setJob` updated as the user typed.
   */
  async function handleJobFieldCommit(field: "position" | "company" | "location" | "contact") {
    const current = job[field] ?? "";
    const trimmed = current.trim();
    const corrected = { ...job, [field]: field === "contact" ? trimmed || null : trimmed };
    if (trimmed !== current) setJob(corrected);
    if (tabUrl && corrected.position) await setCachedJob(tabUrl, corrected).catch(() => undefined);
  }

  /** Looks up a previously-saved Drive application for `url` (spec_7 item 8) — tolerant of Drive not being connected yet. */
  async function checkExistingApplication(url: string) {
    try {
      setExistingApplication(url ? await getApplicationByUrl(url) : null);
    } catch {
      setExistingApplication(null);
    }
  }

  async function handleReset() {
    await clearTabState(tabId);
    setJob(EMPTY_JOB);
    setCoverLetter("");
    setOutreachMessage(null);
    setOutreachError(null);
    setOutreachImproveInstructions("");
    setCleanedNotice(null);
    setTranslations({});
    setActiveTranslationLanguage("");
    setCustomQuestions([]);
    ingestedTagsRef.current.clear();
    setQuestionAnswers({});
    setInsufficientInfoQuestions(new Set());
    setCheckboxDecisions([]);
    setJobLanguage(null);
    setJobKeywords([]);
    void sendMessage({ type: "CLEAR_KEYWORD_HIGHLIGHTS", tabId }).catch(() => undefined);
    setExistingApplication(null);
    setPasteMode(false);
    setPasteText("");
    setError(null);
    setAutofillStatus(null);
    void handleGeneratedPassword(generatePassword());
    void bootstrapJob(true);
  }

  // Time-to-apply starts the first time a posting is read (only the first: revisits keep it).
  useEffect(() => {
    if (job.url && (job.position || job.company)) void recordWorkStart(job.url).catch(() => undefined);
  }, [job.url, job.position, job.company]);

  /** "Mark as applied": ends this posting's time-to-apply and files it as applied in Drive. */
  async function handleMarkApplied() {
    setMarkingApplied(true);
    setError(null);
    try {
      const saved = await markJobApplied(job, await getWorkStart(job.url));
      if (saved) setExistingApplication(saved);
      void recordUrlActivation(job.url);
    } catch (err) {
      setError(t("main.markAppliedFailed", { error: err instanceof Error ? err.message : "" }));
    } finally {
      setMarkingApplied(false);
    }
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
      outreachMessage,
      pasteMode,
      pasteText,
      translations,
      activeTranslationLanguage,
      customQuestions,
      customQuestionAnswers: questionAnswers,
      checkboxDecisions,
      jobLanguage,
      generatedPassword,
      extractedPosition: extractedJobRef.current.position,
      extractedCompany: extractedJobRef.current.company,
    });
  }, [
    tabId,
    tabUrl,
    job,
    coverLetter,
    outreachMessage,
    pasteMode,
    pasteText,
    translations,
    activeTranslationLanguage,
    customQuestions,
    questionAnswers,
    checkboxDecisions,
    jobLanguage,
    generatedPassword,
  ]);

  // Every language in "My Languages" (Settings) gets its own translation
  // automatically — that's the whole point of maintaining that list — plus
  // whatever the dropdown is currently set to, for a one-off language
  // outside that list. Keeps the Translate tab "always on" (spec_2 item 3):
  // re-translates whenever the draft changes, in parallel across languages,
  // so the user never has to manually re-trigger any of them.
  const myLanguages = languageLevels.map((l) => l.language.trim()).filter(Boolean);
  const targetLanguages = Array.from(new Set([...myLanguages, translateLanguage].filter(Boolean)));
  const targetLanguagesKey = targetLanguages.join("|");
  // Falls back to the first configured language whenever the stored/active
  // one isn't (or is no longer) among the current targets — e.g. right
  // after a fresh job with no cache yet, or if it was removed from Settings.
  const effectiveActiveLanguage = targetLanguages.includes(activeTranslationLanguage)
    ? activeTranslationLanguage
    : (targetLanguages[0] ?? "");
  useEffect(() => {
    if (!hasLoadedRef.current || !coverLetter) return;
    const languages = targetLanguagesKey ? targetLanguagesKey.split("|") : [];
    if (languages.length === 0) return;
    const timeout = setTimeout(() => {
      setTranslatingLanguages(new Set(languages));
      for (const language of languages) {
        sendMessage<MessageOf<"TRANSLATE_COVER_LETTER_RESULT">>({
          type: "TRANSLATE_COVER_LETTER",
          content: coverLetter,
          targetLanguage: language,
        })
          .then((response) => {
            setTranslations((prev) => ({ ...prev, [language]: response.content }));
          })
          .catch(() => {
            // Leave whatever was there before in place rather than clearing it on a transient failure.
          })
          .finally(() => {
            setTranslatingLanguages((prev) => {
              const next = new Set(prev);
              next.delete(language);
              return next;
            });
          });
      }
    }, 1500);
    return () => clearTimeout(timeout);
  }, [coverLetter, targetLanguagesKey]);

  // Keep a PDF rendering of the cover letter ready so dragging it onto the
  // page can carry an actual file, not just plain text — pdf() is async and
  // dragstart must attach data synchronously, so this can't be rendered on
  // demand at drag time.
  useEffect(() => {
    if (!coverLetter) {
      coverLetterFileRef.current = null;
      setCoverLetterFileReady(false);
      return;
    }
    setCoverLetterFileReady(false);
    const timeout = setTimeout(() => {
      void renderCoverLetterPdf(coverLetter, `Cover Letter - ${job.company || "application"}.pdf`)
        .then((file) => {
          coverLetterFileRef.current = file;
          setCoverLetterFileReady(true);
        })
        .catch(() => setCoverLetterFileReady(false));
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
      const activeContent = translations[effectiveActiveLanguage];
      const translation = activeContent ? { language: effectiveActiveLanguage, content: activeContent } : null;
      void saveCoverLetterDraft(job, coverLetter, translation)
        .then(() => setDriveSaveStatus("saved"))
        .catch(() => setDriveSaveStatus("error"));
    }, 1500);
    return () => clearTimeout(timeout);
  }, [job, coverLetter, translations, effectiveActiveLanguage]);

  async function bootstrapJob(force = false) {
    setLoadingJob(true);
    setError(null);
    let detectedJob: Job = job;
    let incomplete: MessageOf<"JOB_DATA"> | undefined;
    try {
      const response = await sendMessage<MessageOf<"JOB_DATA"> | undefined>({
        type: "GET_JOB",
        tabId,
        force,
      });
      setNeedsTabAccess(false);
      if (response?.job) {
        detectedJob = response.job;
        extractedJobRef.current = { position: response.job.position, company: response.job.company };
        setJob(response.job);
        if (!response.sufficient) incomplete = response;
        if (response.brief) void applyJobBrief(response.job, response.brief);
        else if (!incomplete) void handleDetectJobBrief(response.job);
        void checkExistingApplication(response.job.url);
        const prefs = await getPreferences();
        if (prefs.autofillOnOpen) await runAutofill();
      } else if (await lacksTabAccess()) {
        setNeedsTabAccess(true);
      }
    } catch {
      if (await lacksTabAccess()) setNeedsTabAccess(true);
      else setError(t("main.cantReadPage"));
    } finally {
      setLoadingJob(false);
      hasLoadedRef.current = true;
    }
    // Not awaited: the panel is usable on the DOM result while the AI fills the gaps.
    if (incomplete) void completeJobInBackground(incomplete).then((completed) => handleAnalyzePageContent(completed));
    else void handleAnalyzePageContent(detectedJob);
  }

  /**
   * Fills what a DOM-insufficient extraction missed (usually the company) and brings the brief
   * along, while the DOM result is already on screen. Fields the user edited meanwhile are kept,
   * and a result for a page the panel has since left is dropped. Resolves to the job on screen.
   */
  async function completeJobInBackground(partial: MessageOf<"JOB_DATA">): Promise<Job> {
    const dom = partial.job;
    if (!hasApiKey) return dom;
    setCompletingJob(true);
    try {
      const response = await sendMessage<MessageOf<"JOB_DATA"> | undefined>({
        type: "COMPLETE_JOB",
        job: dom,
        text: partial.visibleText ?? "",
      });
      if (!response?.job || jobRef.current.url !== dom.url) return jobRef.current;
      const merged = keepUserEdits(jobRef.current, dom, response.job);
      setJob(merged);
      if (response.brief) void applyJobBrief(merged, response.brief);
      if (partial.pageUrl && merged.position && merged.company) void setCachedJob(partial.pageUrl, merged).catch(() => undefined);
      return merged;
    } catch {
      // No API key yet, or the request failed — keep the DOM result as it is.
      return jobRef.current;
    } finally {
      setCompletingJob(false);
    }
  }

  /**
   * Applies a brief (language, keywords, and — only when the Job didn't already have one — a
   * found contact) to local state and re-highlights the page. Shared by `handleDetectJobBrief`
   * (the DOM-sufficient path, which still sends its own DETECT_JOB_BRIEF request) and the
   * bootstrap/navigation/paste-text call sites that already got a brief for free from the merged
   * AI extraction call (`extractJobWithAiAndBrief`) — those skip the extra round trip entirely.
   */
  async function applyJobBrief(
    currentJob: Job,
    brief: { language: JobLanguageInfo | null; keywords: JobKeyword[]; contact: string | null },
  ) {
    const resolvedContact = currentJob.contact ?? brief.contact;
    if (brief.contact && !currentJob.contact) {
      setJob((j) => ({ ...j, contact: brief.contact }));
    }
    setJobLanguage(brief.language);
    setJobKeywords(brief.keywords);
    if (!highlightOnPage) return;
    const highlightList = withContactHighlight(brief.keywords, resolvedContact);
    if (highlightList.length > 0) {
      await sendMessage({ type: "HIGHLIGHT_KEYWORDS", tabId, keywords: highlightList }).catch(() => undefined);
    }
  }

  /**
   * Language detection + keyword extraction + a contact lookup (spec_8 item 2) run automatically
   * on every job load, combined into one MODEL_LUNA call (`analyzeJobBrief`) instead of separate
   * round trips over the same job/applicant context.
   */
  async function handleDetectJobBrief(currentJob: Job) {
    if (!hasApiKey) return;
    setBriefLoading(true);
    try {
      const response = await sendMessage<{
        type: "JOB_BRIEF_DATA";
        language: JobLanguageInfo;
        keywords: JobKeyword[];
        contact: string | null;
      }>({ type: "DETECT_JOB_BRIEF", job: currentJob });
      await applyJobBrief(currentJob, {
        language: response?.language ?? null,
        keywords: response?.keywords ?? [],
        contact: response?.contact ?? null,
      });
    } catch {
      // No API key yet, or the request failed — leave the brief/keyword list empty.
    } finally {
      setBriefLoading(false);
    }
  }

  function handleToggleHighlightOnPage() {
    setHighlightOnPage((prev) => {
      const next = !prev;
      const highlightList = withContactHighlight(jobKeywords, job.contact);
      if (next && highlightList.length > 0) {
        void sendMessage({ type: "HIGHLIGHT_KEYWORDS", tabId, keywords: highlightList }).catch(() => undefined);
      } else {
        void sendMessage({ type: "CLEAR_KEYWORD_HIGHLIGHTS", tabId }).catch(() => undefined);
      }
      return next;
    });
  }

  async function handleDetectQuestions(currentJob: Job = job) {
    setDetectingQuestions(true);
    let questions: CustomQuestion[] = [];
    try {
      const response = await sendMessage<{ type: "CUSTOM_QUESTIONS_DATA"; questions: CustomQuestion[] }>({
        type: "DETECT_CUSTOM_QUESTIONS",
        tabId,
      });
      questions = response?.questions ?? [];
      setCustomQuestions(questions);
    } catch {
      // No content script on this page (e.g. a chrome:// tab) — nothing to detect.
    } finally {
      setDetectingQuestions(false);
    }
    // Detection itself is a local DOM scan (harmless without a key); only the
    // answering pass needs OpenAI, and its JSX is hidden without one anyway.
    if (questions.length > 0 && hasApiKey) void answerAndFillQuestions(questions, currentJob);
  }

  /**
   * Answers every detected question (MODEL_LUNA) and writes each answer
   * straight into its field, automatically, as soon as the panel opens on a
   * posting. The user only opens the Side Panel on job pages, so this never
   * spends tokens elsewhere. Answers stay listed below, editable and
   * draggable exactly as before.
   */
  async function answerAndFillQuestions(
    questions: CustomQuestion[],
    currentJob: Job,
    seed?: Record<string, string>,
  ) {
    // `seed` carries answers known without asking the model (e.g. a pronoun
    // group answered straight from the profile) — `questionAnswers` state
    // hasn't flushed yet when this is called right after `setQuestionAnswers`.
    // Keyed by `questionAnswerKey`, not raw `question` text: several
    // picker-added fields on the same custom form routinely share an
    // identical generic prompt (e.g. two "Type your answer here…" textareas
    // whose real question lives in a sibling `<p>` the deterministic pass
    // missed), and text-keying would collapse them into one answer slot —
    // one field silently gets no answer, or the other field's answer.
    const answersByQuestion = { ...questionAnswers, ...seed };
    const pending = questions.filter((q) => !answersByQuestion[questionAnswerKey(q)]);

    setAnsweringAllQuestions(true);
    try {
      if (pending.length > 0) {
        const postingLanguage = jobLanguage?.postingLanguages[0];
        const results = await Promise.allSettled(
          pending.map((q) =>
            sendMessage<{ type: "CUSTOM_QUESTION_ANSWER"; question: string; answer: string; sufficientInfo: boolean }>({
              type: "ANSWER_CUSTOM_QUESTION",
              question: q.question,
              job: currentJob,
              options: q.options,
              multi: q.multi,
              numeric: q.numeric,
              dateKind: q.dateKind,
              postingLanguage,
            }),
          ),
        );
        const failures: string[] = [];
        const insufficient = new Set<string>();
        results.forEach((result, i) => {
          if (result.status === "fulfilled" && result.value?.answer) {
            answersByQuestion[questionAnswerKey(pending[i])] = result.value.answer;
          } else if (result.status === "fulfilled" && result.value && !result.value.sufficientInfo) {
            insufficient.add(questionAnswerKey(pending[i]));
          } else if (result.status === "rejected") {
            failures.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
          }
        });
        if (insufficient.size > 0) {
          setInsufficientInfoQuestions((prev) => new Set([...prev, ...insufficient]));
        }
        // Merge over the latest state, not the closure's snapshot — the
        // picker fires this concurrently across picks without a re-render in
        // between, so a plain replace would drop a sibling pick's answers.
        setQuestionAnswers((prev) => ({ ...prev, ...answersByQuestion }));
        // Every question failed the same way (no API key, quota, org not
        // verified for the model, network) — surface that instead of
        // leaving the cards on a misleading "add your key" hint.
        if (failures.length > 0 && failures.length === pending.length) {
          setError(t("main.answerQuestionsFailed", { error: failures[0] }));
        }
      }

      await fillQuestionAnswers(questions, answersByQuestion);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("main.answerQuestionsFailed", { error: "" }));
    } finally {
      setAnsweringAllQuestions(false);
    }
  }

  /**
   * Writes already-known answers (keyed by `questionAnswerKey`) into the page: auto-detected
   * questions by matching their label text on a re-scan, picker-added ones by their `locator`
   * instead, since their field often has no question-shaped label to match. Shared by
   * `answerAndFillQuestions` (one call per question, run in parallel) and
   * `handleAnalyzePageContent`'s batched question-answering — both end up with the same
   * `questionAnswerKey -> answer` map to write onto the page.
   */
  /** `mergeUnfillable`: add to the "couldn't fill" list instead of replacing it (a second batch filling alongside the first). */
  async function fillQuestionAnswers(questions: CustomQuestion[], answersByQuestion: Record<string, string>, mergeUnfillable = false) {
    const textAnswers: Record<string, string> = {};
    const locatorItems: { locator: ElementLocator; answer: string; question?: string }[] = [];
    for (const q of questions) {
      const answer = answersByQuestion[questionAnswerKey(q)];
      if (!answer) continue;
      if (q.locator) locatorItems.push({ locator: q.locator, answer, question: q.question });
      else textAnswers[q.question] = answer;
    }
    type FillResult = { type: "CUSTOM_QUESTION_FILL_RESULT"; filled: number; unfilled: string[] };
    const fills: Promise<FillResult>[] = [];
    if (Object.keys(textAnswers).length > 0) {
      fills.push(sendMessage<FillResult>({ type: "FILL_CUSTOM_QUESTION_ANSWERS", tabId, answers: textAnswers }));
    }
    if (locatorItems.length > 0) {
      fills.push(sendMessage<FillResult>({ type: "FILL_QUESTION_ANSWERS_BY_LOCATOR", tabId, items: locatorItems }));
    }
    const fillResults = await Promise.all(fills);
    const unfilled = fillResults.flatMap((r) => r.unfilled);
    setUnfillableQuestions((prev) => (mergeUnfillable ? [...new Set([...prev, ...unfilled])] : unfilled));
  }

  /**
   * Manual fallback (spec_7 item 12) for a question the picker/automatic
   * detection couldn't find: typed by hand, with no `locator`, so it's
   * answered the same way any locator-less question is — a text-match fill
   * is attempted against the page (a harmless no-op if nothing matches) and
   * the answer is always shown in the list below, ready to copy or drag.
   */
  async function handleAddManualQuestion() {
    const question = manualQuestionText.trim();
    if (!question) return;
    setAddingManualQuestion(true);
    try {
      const newQuestion: CustomQuestion = { id: `manual-${Date.now().toString(36)}`, question };
      setCustomQuestions((prev) => [...prev, newQuestion]);
      setManualQuestionText("");
      await answerAndFillQuestions([newQuestion], job);
    } finally {
      setAddingManualQuestion(false);
    }
  }

  /** Turn one picked block into answered, filled question cards. */
  async function ingestPickedFields(pickedFields: PickedField[], blockText: string, semanticCount: number) {
    try {
      await ingestPickedFieldsInner(pickedFields, blockText, semanticCount);
    } catch (err) {
      // The picker loop calls this un-awaited, pick after pick — a throw here
      // must not become an unhandled rejection that leaves the loop or the
      // on-page overlay in a bad state.
      setError(err instanceof Error ? err.message : t("main.selectionFailed"));
    }
  }

  async function ingestPickedFieldsInner(
    pickedFields: PickedField[],
    blockText: string,
    semanticCount: number,
  ) {
    // Anything the autofill engine recognises in the pick (email, phone,
    // LinkedIn, country…) is filled by Autofill first, not asked as a question.
    if (semanticCount > 0) await runAutofill();

    if (pickedFields.length === 0) {
      if (semanticCount === 0) {
        setError(t("main.noFieldsInSelection"));
      }
      return;
    }

    let picked = pickedFields;
    if (picked.some((p) => !p.confident)) {
      try {
        const ai = await sendMessage<{ type: "BLOCK_QUESTIONS"; questions: Record<number, string> }>({
          type: "DECOMPOSE_BLOCK",
          blockText,
          fields: picked.map((p) => p.descriptor),
        });
        picked = picked.map((p, i) => (ai.questions[i] ? { ...p, question: ai.questions[i] } : p));
      } catch {
        // No API key / request failed — keep whatever deterministic text we have.
      }
    }

    const additions: CustomQuestion[] = picked
      .filter((p) => p.question.trim())
      .map((p, i) => ({
        id: `picked-${Date.now().toString(36)}-${i}`,
        question: p.question.trim(),
        locator: p.locator,
        options: p.options && p.options.length > 0 ? p.options : undefined,
        multi: p.multi,
        numeric: p.numeric,
        dateKind: p.dateKind,
      }));
    if (additions.length === 0) {
      setError(t("main.noQuestionsInBlock"));
      return;
    }

    // Compute `fresh` synchronously against a ref — reading it back from the
    // `setCustomQuestions` updater below saw a stale `[]` (the updater is
    // flushed after this tick), so the early return skipped answering
    // entirely: cards appeared, but no model call was ever made.
    const fresh = additions.filter((q) => {
      const tag = q.locator?.tag;
      if (tag && ingestedTagsRef.current.has(tag)) return false;
      if (tag) ingestedTagsRef.current.add(tag);
      return true;
    });
    if (fresh.length === 0) return;
    setCustomQuestions((prev) => {
      const prevTags = new Set(prev.map((q) => q.locator?.tag).filter(Boolean));
      return [...prev, ...fresh.filter((q) => !q.locator?.tag || !prevTags.has(q.locator.tag))];
    });

    // A pronoun choice is answered straight from the profile — no model call.
    const seed: Record<string, string> = {};
    for (const q of fresh) {
      if (profile.pronouns && /\bpronoun/i.test(q.question)) seed[questionAnswerKey(q)] = profile.pronouns;
    }
    if (Object.keys(seed).length > 0) setQuestionAnswers((prev) => ({ ...prev, ...seed }));
    void answerAndFillQuestions(fresh, job, seed);
  }

  /**
   * Manual counterpart to `handleDetectQuestions`: the user visually picks
   * blocks that hold questions. The picker stays on — pick after pick — and
   * only ends on Esc, the "Stop picking" button, or the panel closing (a
   * disconnect port tells the background to tear the overlay down).
   */
  async function handleStartPicker() {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    setError(null);
    try {
      pickerPortRef.current = chrome.runtime.connect({ name: `picker-${tabId}` });
    } catch {
      // Port is a best-effort cleanup channel; the picker still works without it.
    }
    try {
      while (pickingRef.current) {
        const res = await sendMessage<{
          type: "ELEMENT_PICKER_RESULT";
          cancelled: boolean;
          picked: PickedField[];
          blockText: string;
          semanticCount: number;
        }>({ type: "START_ELEMENT_PICKER", tabId });
        if (res.cancelled || !pickingRef.current) break;
        // Don't await — re-arm the overlay immediately so picking feels
        // continuous while answers generate in the background.
        void ingestPickedFields(res.picked, res.blockText, res.semanticCount);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("main.pickerFailed"));
    } finally {
      pickingRef.current = false;
      setPicking(false);
      pickerPortRef.current?.disconnect();
      pickerPortRef.current = null;
      void sendMessage({ type: "CANCEL_ELEMENT_PICKER", tabId }).catch(() => {});
    }
  }

  function handleStopPicker() {
    pickingRef.current = false;
    pickerPortRef.current?.disconnect();
    pickerPortRef.current = null;
    void sendMessage({ type: "CANCEL_ELEMENT_PICKER", tabId }).catch(() => {});
  }

  // Tab switch / panel close mid-pick: make sure the on-page overlay goes away.
  useEffect(() => {
    return () => {
      if (pickingRef.current) {
        pickingRef.current = false;
        pickerPortRef.current?.disconnect();
        void sendMessage({ type: "CANCEL_ELEMENT_PICKER", tabId }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab switch / panel close: don't leave keyword highlights painted on a
  // page the user has moved away from (spec_8 item 2).
  useEffect(() => {
    return () => {
      void sendMessage({ type: "CLEAR_KEYWORD_HIGHLIGHTS", tabId }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Alt+P toggles the picker — press again to end the mode (issue: reaching
  // for the button after every pick). Only fires while the Side Panel holds
  // focus, which is where the button lives anyway.
  useEffect(() => {
    const onHotkey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (e.repeat || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey !== true) return;
      if (e.code !== "KeyP") return;
      e.preventDefault();
      if (pickingRef.current) handleStopPicker();
      else void handleStartPicker();
    };
    window.addEventListener("keydown", onHotkey);
    return () => window.removeEventListener("keydown", onHotkey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Consent/marketing checkboxes and custom application questions: detect both on the page
   * (DOM-only, free), then decide the checkboxes and answer the questions in one combined AI
   * call (`DECIDE_PAGE_CONTENT`) instead of a separate checkbox-decision call plus one parallel
   * call per question, and apply both back onto the page. Runs automatically on panel open — the
   * applicant is here to apply, so ticking the required boxes and pre-filling the answers is what
   * they'd do by hand anyway.
   */
  async function handleAnalyzePageContent(currentJob: Job) {
    setDetectingQuestions(true);
    const [checkboxResponse, questionResponse] = await Promise.all([
      sendMessage<{ type: "CHECKBOXES_DATA"; checkboxes: PageCheckbox[] }>({
        type: "DETECT_CHECKBOXES",
        tabId,
      }).catch(() => undefined),
      sendMessage<{ type: "CUSTOM_QUESTIONS_DATA"; questions: CustomQuestion[] }>({
        type: "DETECT_CUSTOM_QUESTIONS",
        tabId,
      }).catch(() => undefined),
    ]);
    setDetectingQuestions(false);

    const checkboxes = checkboxResponse?.checkboxes ?? [];
    const questions = questionResponse?.questions ?? [];
    setCustomQuestions(questions);
    if (checkboxes.length === 0) setCheckboxDecisions([]);

    if (!hasApiKey) return;
    const pending = questions.filter((q) => !questionAnswers[questionAnswerKey(q)]);
    if (checkboxes.length === 0 && pending.length === 0) return;

    setDecidingPageContent(true);
    const postingLanguage = jobLanguage?.postingLanguages[0];
    type Decided = {
      type: "PAGE_CONTENT_DECISIONS";
      checkboxDecisions: CheckboxDecision[];
      questionAnswers: { id: string; answer: string; sufficientInfo: boolean }[];
    };
    const decide = (boxes: PageCheckbox[], qs: CustomQuestion[]) =>
      sendMessage<Decided>({ type: "DECIDE_PAGE_CONTENT", checkboxes: boxes, questions: qs, job: currentJob, postingLanguage });
    // Two requests in parallel: checkboxes + option questions are classified (fast), free-text
    // questions are written — so the first fill doesn't wait for text generation.
    const choicePending = pending.filter((q) => hasChoiceOptions(q));
    const textPending = pending.filter((q) => !hasChoiceOptions(q));
    const batches: Promise<void>[] = [];
    setUnfillableQuestions([]);
    if (checkboxes.length > 0 || choicePending.length > 0) {
      batches.push(
        decide(checkboxes, choicePending).then(async (response) => {
          if (checkboxes.length > 0) {
            const decisions = response?.checkboxDecisions ?? [];
            setCheckboxDecisions(decisions);
            if (decisions.length > 0) {
              await sendMessage<{ type: "CHECKBOX_APPLY_RESULT"; changed: number }>({
                type: "APPLY_CHECKBOX_DECISIONS",
                tabId,
                decisions: decisions.map((d) => ({ name: d.name, label: d.label, check: d.check })),
              });
            }
          }
          if (choicePending.length > 0) await applyPageContentQuestionAnswers(choicePending, response?.questionAnswers ?? []);
        }),
      );
    }
    if (textPending.length > 0) {
      batches.push(decide([], textPending).then((response) => applyPageContentQuestionAnswers(textPending, response?.questionAnswers ?? [])));
    }
    const failed = (await Promise.allSettled(batches)).find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : t("main.analyzeFormFailed"));
    setDecidingPageContent(false);
  }

  /** Merges the batched DECIDE_PAGE_CONTENT question answers (keyed by id) into state and fills them, same as `answerAndFillQuestions`'s tail. */
  async function applyPageContentQuestionAnswers(
    pending: CustomQuestion[],
    raw: { id: string; answer: string; sufficientInfo: boolean }[],
  ) {
    const byId = new Map(raw.map((r) => [r.id, r]));
    const answersByQuestion: Record<string, string> = {};
    const insufficient = new Set<string>();
    for (const q of pending) {
      const found = byId.get(q.id);
      if (found?.answer) answersByQuestion[questionAnswerKey(q)] = found.answer;
      else if (found && !found.sufficientInfo) insufficient.add(questionAnswerKey(q));
    }
    if (insufficient.size > 0) setInsufficientInfoQuestions((prev) => new Set([...prev, ...insufficient]));
    setQuestionAnswers((prev) => ({ ...prev, ...answersByQuestion }));
    await fillQuestionAnswers(pending, answersByQuestion, true);
  }

  async function handleImprove() {
    if (!improveInstructions.trim()) return;
    setImproving(true);
    setError(null);
    try {
      const response = await sendMessage<MessageOf<"REVISE_COVER_LETTER_RESULT">>({
        type: "REVISE_COVER_LETTER",
        job,
        content: coverLetter,
        instructions: improveInstructions,
      });
      await handleCoverLetterChange(response.content);
      setImproveInstructions("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("main.improveFailed"));
    } finally {
      setImproving(false);
    }
  }

  async function handleTranslateLanguageChange(language: string) {
    setTranslateLanguage(language);
    setActiveTranslationLanguage(language);
    await setPreferences({ translateLanguage: language });
  }

  async function handleExtractFromPastedText() {
    if (!pasteText.trim()) return;
    setPasting(true);
    setError(null);
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job; brief?: JobBrief }>({
        type: "EXTRACT_JOB_FROM_TEXT",
        tabId,
        text: pasteText,
      });
      if (response?.job) {
        extractedJobRef.current = { position: response.job.position, company: response.job.company };
        setJob(response.job);
        if (response.brief) void applyJobBrief(response.job, response.brief);
        else void handleDetectJobBrief(response.job);
      }
      setPasteMode(false);
      setPasteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("main.pasteFailed"));
    } finally {
      setPasting(false);
    }
  }

  // Cover-letter generation is streamed (spec: the longest, most-watched AI call in the app) —
  // `COVER_LETTER_STREAM_CHUNK` broadcasts arrive via the listener below and append live to
  // `coverLetter` while this request is in flight; the request itself still resolves with the
  // final, authoritative text (possibly AI-slop-cleaned, which the stream can't reflect).
  useEffect(() => {
    function handleStreamChunk(message: RuntimeMessage) {
      // Only the panel awaiting the request appends chunks; a resumed one follows session storage.
      if (message.type === "COVER_LETTER_STREAM_CHUNK" && message.tabId === tabId && ownRunRef.current) {
        setCoverLetter((prev) => prev + message.delta);
      }
    }
    chrome.runtime.onMessage.addListener(handleStreamChunk);
    return () => chrome.runtime.onMessage.removeListener(handleStreamChunk);
  }, [tabId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    setCleanedNotice(null);
    setCoverLetter("");
    ownRunRef.current = true;
    resumedRunRef.current = false;
    try {
      const response = await sendMessage<MessageOf<"COVER_LETTER_RESULT">>({ type: "GENERATE_COVER_LETTER", tabId, job, postingLanguage: jobLanguage?.postingLanguages[0] });
      setCoverLetter(response.content);
      void markRunApplied();
      if (job.url) void recordUrlActivation(job.url);
      if (response.cleaned) {
        const patterns = Array.from(new Set(response.slopFindings.map((f) => f.pattern))).join(", ");
        setCleanedNotice(t("main.cleanedNotice", { patterns }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("main.generateFailed"));
    } finally {
      ownRunRef.current = false;
      setGenerating(false);
    }
  }

  async function markRunApplied() {
    const run = await getCoverLetterRun(tabId);
    if (run?.status === "done") await setCoverLetterRun(tabId, { ...run, status: "applied" });
  }

  /** Shows a run's state when this panel isn't the one awaiting it — see `resumeCoverLetterRun`. */
  function applyCoverLetterRun(run: CoverLetterRun) {
    if (run.status === "generating") {
      setGenerating(true);
      setCoverLetter(run.content);
      return;
    }
    resumedRunRef.current = false;
    setGenerating(false);
    if (run.status === "done") {
      setCoverLetter(run.content);
      if (run.cleanedPatterns?.length) {
        setCleanedNotice(t("main.cleanedNotice", { patterns: run.cleanedPatterns.join(", ") }));
      }
      if (run.jobUrl) void recordUrlActivation(run.jobUrl);
      void markRunApplied();
    } else if (run.status === "error") {
      setError(run.error ?? t("main.generateFailed"));
    }
  }

  /**
   * Chrome may unload this panel while the user is on another tab, dropping the request it was
   * awaiting — the background keeps generating and records progress per tab. On return, pick
   * that up: a letter still streaming is followed through storage, a finished one not shown yet
   * is shown now. An "applied" run is already in the draft (and maybe edited since), so it's left alone.
   */
  async function resumeCoverLetterRun(jobUrl: string) {
    const run = await getCoverLetterRun(tabId);
    if (!run || run.jobUrl !== jobUrl || run.status === "applied") return;
    if (run.status === "generating") resumedRunRef.current = true;
    applyCoverLetterRun(run);
  }

  useEffect(() => {
    const runKey = coverLetterRunKey(tabId);
    function onSessionChanged(changes: Record<string, chrome.storage.StorageChange>) {
      const run = changes[runKey]?.newValue as CoverLetterRun | undefined;
      if (!run || !resumedRunRef.current || ownRunRef.current) return;
      if (run.jobUrl !== jobRef.current.url) return;
      applyCoverLetterRun(run);
    }
    chrome.storage.session.onChanged.addListener(onSessionChanged);
    return () => chrome.storage.session.onChanged.removeListener(onSessionChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  async function handleCoverLetterChange(text: string) {
    setCoverLetter(text);
    await setLocal("lastCoverLetter", text);
  }

  /** "Generate outreach message" — drafts the email/LinkedIn note to send to the posting's recruiter/hiring contact before or alongside applying. */
  async function handleGenerateOutreach() {
    setGeneratingOutreach(true);
    setOutreachError(null);
    try {
      const response = await sendMessage<MessageOf<"OUTREACH_MESSAGE_RESULT">>({
        type: "GENERATE_OUTREACH_MESSAGE",
        tabId,
        job,
        contact: job.contact ?? "",
        postingLanguage: jobLanguage?.postingLanguages[0],
      });
      setOutreachMessage({ subject: response.subject, body: response.body });
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : t("main.outreachFailed"));
    } finally {
      setGeneratingOutreach(false);
    }
  }

  async function handleImproveOutreach() {
    if (!outreachMessage || !outreachImproveInstructions.trim()) return;
    setImprovingOutreach(true);
    setOutreachError(null);
    try {
      const response = await sendMessage<MessageOf<"OUTREACH_MESSAGE_RESULT">>({
        type: "REVISE_OUTREACH_MESSAGE",
        job,
        subject: outreachMessage.subject,
        body: outreachMessage.body,
        instructions: outreachImproveInstructions,
      });
      setOutreachMessage({ subject: response.subject, body: response.body });
      setOutreachImproveInstructions("");
    } catch (err) {
      setOutreachError(err instanceof Error ? err.message : t("main.outreachImproveFailed"));
    } finally {
      setImprovingOutreach(false);
    }
  }

  async function handleCopyOutreachMessage() {
    if (!outreachMessage) return;
    const text = outreachMessage.subject
      ? `Subject: ${outreachMessage.subject}\n\n${outreachMessage.body}`
      : outreachMessage.body;
    try {
      await navigator.clipboard.writeText(text);
      setOutreachCopied(true);
      setTimeout(() => setOutreachCopied(false), 1500);
    } catch {
      // Best effort — nothing else to do if the clipboard API is unavailable here.
    }
  }

  /** `job.contact`'s own shape decides the channel: an email address opens a Gmail compose draft, anything else (a LinkedIn URL) just opens that link so the user pastes the message in themselves. */
  function outreachContactHref(contact: string, message: { subject: string | null; body: string }): string {
    if (isEmailAddress(contact)) {
      // Gmail's web composer rather than `mailto:`: a Side Panel link to `mailto:` silently does nothing when no desktop mail client is registered.
      const params = new URLSearchParams({ view: "cm", fs: "1", to: contact, body: message.body });
      if (message.subject) params.set("su", message.subject);
      return `https://mail.google.com/mail/?${params.toString()}`;
    }
    return contact;
  }

  /** `language` is a display name from `LANGUAGES` (e.g. "German") appended to the filename for a translated export. */
  async function handleExportPdf(content: string, language?: string) {
    try {
      const suffix = language ? ` (${language})` : "";
      const file = await renderCoverLetterPdf(content, `Cover Letter - ${job.company || "application"}${suffix}.pdf`);
      await downloadFile(file);
    } catch (err) {
      setError(t("main.pdfExportFailed", { error: err instanceof Error ? err.message : "" }));
    }
  }

  function handleCoverLetterDragStart(e: DragEvent<HTMLElement>) {
    e.dataTransfer.effectAllowed = "copy";
    // Marker the content-script drop-catcher recognises — Chrome often
    // strips the extension-origin File below, so the catcher re-runs the
    // "attach to page" path targeted at whatever field was dropped onto.
    e.dataTransfer.setData("application/x-filler-attach-coverletter", "1");
    if (coverLetterFileRef.current) e.dataTransfer.items.add(coverLetterFileRef.current);
  }

  /**
   * A real, native browser drag — `e.dataTransfer.items.add(file)` on an
   * actually-fired `dragstart` — is indistinguishable to the page from
   * dragging that same file out of Finder/Explorer: `isTrusted` is true and
   * `dataTransfer.files` holds a real File. That's strictly more reliable
   * than the "CV" button's fallback (dispatching synthetic DragEvents,
   * which a strict dropzone library can and does ignore since those aren't
   * trusted user gestures) — this is the same technique already used for
   * the Cover Letter's drag handle above.
   */
  function handleCvDragStart(e: DragEvent<HTMLElement>) {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-filler-attach-cv", "1");
    if (cvFileRef.current) e.dataTransfer.items.add(cvFileRef.current);
  }

  async function handleUploadCoverLetterToPage(targetLocator?: ElementLocator | null) {
    setAutofillStatus(null);
    try {
      const file = await renderCoverLetterPdf(coverLetter, `Cover Letter - ${job.company || "application"}.pdf`);
      const base64Data = await fileToBase64(file);
      const response = await sendMessage<MessageOf<"UPLOAD_FILE_RESULT">>({
        type: "UPLOAD_FILE",
        tabId,
        kind: "coverLetter",
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        targetLocator,
      });
      setAutofillStatus(
        t("main.coverLetterPlaced", { inputs: response.nativeInputs, zones: response.dropZones }),
      );
    } catch (err) {
      setAutofillStatus(t("main.pdfExportFailed", { error: err instanceof Error ? err.message : "" }));
    }
  }

  /**
   * The active CV adapted to this posting (Adapt CV tab): reuses the values
   * picked there for this tab; if none were AI-picked yet, asks the AI first
   * (only now, on click — not on every panel open), falling back to the
   * offline pre-selection without a key.
   */
  async function handleAdaptedCv(mode: "preview" | "download" | "attach") {
    if (!cvMeta || !adaptTemplate) return;
    setAdaptingCv(true);
    setAdaptStatus(null);
    try {
      let entry = await loadAdaptEntry(tabId, tabUrl, cvMeta.id);
      if (!entry.aiSuggested && hasApiKey && (job.position || job.description)) {
        setAdaptStatus(t("main.pickingValues"));
        entry = await suggestEntry(job, adaptTemplate, entry);
        await saveAdaptEntry(tabId, tabUrl, cvMeta.id, entry);
      }
      if (adaptTemplate.format === "docx") setAdaptStatus(t("main.convertingDocx"));
      if (adaptTemplate.format === "latex") setAdaptStatus(t("main.compilingLatex", { host: LATEX_COMPILE_HOST }));
      const values = resolveValues(adaptTemplate, job, entry.values);
      const { file, notes } = await renderAdaptedCv(cvMeta, adaptTemplate, values, profile, { company: job.company });
      // Background: kept with this posting in Applications; a Drive hiccup mustn't block the preview/attach itself.
      void recordAdaptedCv(job, cvMeta, values, file).catch(() => undefined);
      const note = notes.join(" ") || null;
      if (mode === "preview") {
        await openPdfPreview(file);
        setAdaptStatus(note);
        return;
      }
      if (mode === "download") {
        await downloadFile(file);
        setAdaptStatus(note);
        return;
      }
      const response = await sendMessage<MessageOf<"UPLOAD_FILE_RESULT">>({
        type: "UPLOAD_FILE",
        tabId,
        kind: "cv",
        fileName: file.name,
        mimeType: file.type,
        base64Data: await fileToBase64(file),
      });
      setAdaptStatus(
        [t("main.adaptedCvPlaced", { inputs: response.nativeInputs, zones: response.dropZones }), note]
          .filter(Boolean)
          .join(" "),
      );
    } catch (err) {
      setAdaptStatus(t("main.adaptedCvFailed", { error: err instanceof Error ? err.message : "" }));
    } finally {
      setAdaptingCv(false);
    }
  }

  /** Pushes the CV already on file (Settings) into *this* page's file-upload
   * field — a per-application action, not the one-time "store my CV" step
   * that lives in Settings, so it stays here despite the similar name. */
  async function handleAttachCvToPage(targetLocator?: ElementLocator | null) {
    setAutofillStatus(null);
    const file = await getCvAttachmentFile();
    if (!file) {
      setAutofillStatus(t("main.cvLoadFailed"));
      return;
    }
    const base64Data = await fileToBase64(file);
    const response = await sendMessage<MessageOf<"UPLOAD_FILE_RESULT">>({
      type: "UPLOAD_FILE",
      tabId,
      kind: "cv",
      fileName: file.name,
      mimeType: file.type,
      base64Data,
      targetLocator,
    });
    setAutofillStatus(t("main.cvPlaced", { inputs: response.nativeInputs, zones: response.dropZones }));
  }

  // The content-script drop-catcher fires this when the user drops the CV /
  // Cover Letter card onto a field on the page — inject the real file into
  // exactly that field (native File drag out of an extension page is
  // routinely stripped by Chrome, so the drop alone can't carry it).
  useEffect(() => {
    const listener = (message: unknown, sender: chrome.runtime.MessageSender) => {
      if (sender.tab?.id !== tabId) return;
      const msg = message as { type?: string; kind?: "cv" | "coverLetter"; locator?: ElementLocator | null };
      if (msg.type !== "ATTACH_FILE_AT") return;
      // The drop happened in one frame — send the file back to that frame only.
      const locator = msg.locator ? { ...msg.locator, frameId: sender.frameId } : null;
      if (msg.kind === "cv") void handleAttachCvToPage(locator);
      else if (msg.kind === "coverLetter") void handleUploadCoverLetterToPage(locator);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId, coverLetter, job.company]);

  /**
   * `rescanQuestions` is only for the manual "Autofill Application" button
   * (spec: clicking it is the user's explicit "try again on this page now"
   * moment) — a multi-step/SPA form routinely renders its custom questions
   * only after some initial hydration, or reveals new ones once semantic
   * fields like country get filled, so the panel-open scan can legitimately
   * have missed what's there by the time the user clicks Autofill. The
   * bootstrap/navigation call sites already run `handleAnalyzePageContent`
   * once on their own right after `runAutofill()` — defaulting this to
   * `false` there avoids scanning (and re-answering via the model) twice
   * on every ordinary panel open. `answerAndFillQuestions` re-filters
   * against already-known answers regardless, so a rescan here never
   * re-asks the model about a question it already answered.
   */
  async function runAutofill(rescanQuestions = false) {
    setAutofillStatus(null);
    setAutofilling(true);
    try {
      const response = await sendMessage<{
        type: "AUTOFILL_RESULT";
        filled: number;
        total: number;
        generatedPassword: string | null;
      }>({
        type: "AUTOFILL",
        tabId,
        profile,
      });
      setAutofillStatus(t("main.filledFields", { filled: response.filled, total: response.total }));
      if (response.generatedPassword) await handleGeneratedPassword(response.generatedPassword);
      // spec_6 — only an actual fill counts as "worked this posting", not
      // every panel open (see recordUrlActivation's own doc comment).
      if (response.filled > 0 && job.url) void recordUrlActivation(job.url);
    } catch {
      setAutofillStatus(t("main.autofillFailed"));
    } finally {
      setAutofilling(false);
    }
    if (rescanQuestions) void handleDetectQuestions(job);
  }

  /** Shared by every place a password gets (re)generated — on mount/reset so
   * one is always ready without the user having to ask for it, by the
   * automatic registration-form detection (runAutofill), and by the manual
   * "Regenerate" button below. All need the same copy-to-clipboard +
   * persisted-for-this-tab treatment, since this is the one value the user
   * has no other record of. */
  async function handleGeneratedPassword(password: string) {
    setGeneratedPassword(password);
    setPasswordCopied(false);
    try {
      await navigator.clipboard.writeText(password);
      setPasswordCopied(true);
    } catch {
      // Clipboard access unavailable — the value is still shown/draggable below.
    }
  }

  async function handleCopyGeneratedPassword() {
    if (!generatedPassword) return;
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setPasswordCopied(true);
      // Flips back to showing the password itself after a moment, so the
      // value stays readable and clicking again re-copies it.
      setTimeout(() => setPasswordCopied(false), 1500);
    } catch {
      // Best effort — nothing else to do if the clipboard API is unavailable here.
    }
  }

  // Every background AI/extraction step kicked off automatically on job load, in one place, so
  // the user has a single clear signal for "still working" instead of guessing from fields
  // popping in one at a time — the whole point being asked for (spec: it's otherwise unclear
  // when extraction/analysis is done and the panel is safe to act on, e.g. before Autofill).
  const isAnalyzingJob = loadingJob || completingJob || briefLoading || decidingPageContent;
  // Work the user started that writes the draft or the page: while one runs, every button that would
  // start another (or the same one again) is locked, so repeated clicks can't stack conflicting work.
  const busyTask = generating
    ? t("busy.generating")
    : improving
      ? t("busy.improving")
      : adaptingCv
        ? (adaptStatus ?? t("busy.adaptingCv"))
        : autofilling
          ? t("busy.autofilling")
          : answeringAllQuestions
            ? t("busy.answering")
            : null;
  const locked = busyTask !== null;
  const lockedTitle = locked ? t("busy.wait", { task: busyTask }) : undefined;
  const cvChoice = useCvChoice({
    tabId,
    tabUrl,
    active,
    job,
    postingLanguages: jobLanguage?.postingLanguages,
    settled: !(loadingJob || completingJob || briefLoading),
    cvMeta,
    hasApiKey,
    onCvChange,
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Filler</h1>
        <div className="-mr-1.5 flex items-center gap-0.5">
          <IconButton onClick={() => void handleReset()} label={t("nav.reset")}>
            <RotateCcw />
          </IconButton>
          {setupComplete && (
            <>
              <IconButton onClick={onOpenJobSearch} label={t("nav.jobSearch")}>
                <Search />
              </IconButton>
              <IconButton onClick={onOpenCvAdapt} label={t("nav.adaptCv")}>
                <FileUser />
              </IconButton>
              <IconButton onClick={onOpenApplications} label={t("nav.applications")}>
                <ListChecks />
              </IconButton>
            </>
          )}
          <IconButton onClick={onOpenSettings} label={t("nav.settings")}>
            <Settings />
          </IconButton>
        </div>
      </div>

      {busyTask && (
        <p
          role="status"
          className="flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2 py-1 text-xs font-medium text-primary"
        >
          <Loader2 className="size-3 shrink-0 animate-spin" />
          {busyTask}
        </p>
      )}

      {isAnalyzingJob && !busyTask && (
        <p className="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          {loadingJob
            ? t("main.readingPosting")
            : completingJob
              ? t("main.completingJob")
              : decidingPageContent
              ? t("main.decidingPage")
              : t("main.analyzingBrief")}
        </p>
      )}

      <SetupBanner
        googleConnected={googleConnected}
        hasApiKey={hasApiKey}
        onConnectGoogle={onRequestGoogleConnect}
        onAddApiKey={onRequestApiKey}
      />

      {needsTabAccess && (
        <TabAccessBanner
          url={tabUrl}
          onAllowSite={() => void handleGrantTabAccess(false)}
          onAllowAll={() => void handleGrantTabAccess(true)}
        />
      )}
      <FrameAccessBanner tabId={tabId} onGranted={() => void runAutofill(setupComplete)} />
      {toolbarPinned === false && <PinHint />}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {existingApplication && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            {t("main.alreadyApplied")}
          </span>
          {t("main.preparedOn", {
            what:
              [existingApplication.coverLetter && t("main.aCoverLetter"), existingApplication.adaptedCv && t("main.anAdaptedCv")]
                .filter(Boolean)
                .join(t("main.and")) || t("main.anApplication"),
            date: new Date(existingApplication.createdAt).toLocaleDateString(locale),
            status: t(`status.${existingApplication.status}`),
          })}{" "}
          <button onClick={onOpenApplications} className="underline underline-offset-2">
            {t("main.viewIt")}
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 text-sm">
        <EditableField
          label={t("job.company")}
          value={job.company}
          loading={loadingJob}
          onChange={(company) => setJob((j) => ({ ...j, company }))}
          onCommit={() => void handleJobFieldCommit("company")}
        />
        <EditableField
          label={t("job.position")}
          value={job.position}
          loading={loadingJob}
          onChange={(position) => setJob((j) => ({ ...j, position }))}
          onCommit={() => void handleJobFieldCommit("position")}
        />
        <EditableField
          label={t("job.location")}
          value={job.location}
          loading={loadingJob}
          onChange={(location) => setJob((j) => ({ ...j, location }))}
          onCommit={() => void handleJobFieldCommit("location")}
        />
        <EditableField
          label={t("job.contact")}
          value={job.contact ?? ""}
          loading={loadingJob}
          onChange={(contact) => setJob((j) => ({ ...j, contact: contact || null }))}
          onCommit={() => void handleJobFieldCommit("contact")}
        />
      </div>

      {setupComplete && cvChoice.cvs.length > 1 && (
        <CvChoiceLine
          cvs={cvChoice.cvs}
          activeId={cvMeta?.id ?? null}
          choice={cvChoice.choice}
          choosing={cvChoice.choosing}
          onChange={(id) => void cvChoice.override(id)}
        />
      )}

      {setupComplete && (
        <>
          {jobLanguage && (jobLanguage.postingLanguages.length > 0 || jobLanguage.requirements.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {jobLanguage.postingLanguages.length > 0 && (
                <span className="text-muted-foreground">
                  {t("main.postingLanguage", { languages: jobLanguage.postingLanguages.join(", ") })}
                </span>
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
                    {req.language} {req.level ?? t("main.levelRequired")}
                  </span>
                );
              })}
            </div>
          )}

          {jobKeywords.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{t("main.keywords")}</p>
                <button
                  onClick={handleToggleHighlightOnPage}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  {highlightOnPage ? t("main.stopHighlighting") : t("main.highlightOnPage")}
                </button>
              </div>
              <ul className="flex flex-wrap gap-1">
                {[...jobKeywords]
                  .sort((a, b) => Number(a.kind === "soft") - Number(b.kind === "soft"))
                  .map((kw) => (
                    <li
                      key={kw.text}
                      title={`${kw.kind === "soft" ? t("main.softSkill") : t("main.hardSkill")} · ${
                        kw.matchesProfile ? t("main.matchesProfile") : t("main.notInProfile")
                      }`}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-xs font-medium",
                        kw.matchesProfile
                          ? "border-emerald-300 bg-emerald-100/60 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          : "border-rose-300 bg-rose-100/60 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
                      )}
                    >
                      {kw.text}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <button
            onClick={() => setShowJobText((v) => !v)}
            className="w-fit text-xs text-muted-foreground underline underline-offset-2"
          >
            {showJobText ? t("main.hideJobText") : t("main.showJobText")}
          </button>

          {showJobText && (
            <div className="flex flex-col gap-2 rounded-md border border-border p-2">
              <p className="text-xs text-muted-foreground">
                {t("main.jobTextHint")}
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("job.description")}</label>
                <textarea
                  className="min-h-24 rounded-md border border-border bg-background p-2 text-sm outline-none"
                  value={job.description}
                  onChange={(e) => setJob((j) => ({ ...j, description: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("job.requirements")}</label>
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
                <label className="text-xs text-muted-foreground">{t("job.responsibilities")}</label>
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
            {pasteMode ? t("common.cancel") : t("main.pasteInstead")}
          </button>

          {pasteMode && (
            <div className="flex flex-col gap-2">
              <textarea
                className="min-h-24 rounded-md border border-border bg-background p-2 text-sm outline-none"
                placeholder={t("main.pastePlaceholder")}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <Button size="sm" onClick={handleExtractFromPastedText} disabled={pasting || !pasteText.trim()}>
                {pasting ? t("main.reading") : t("main.useThisText")}
              </Button>
            </div>
          )}
        </>
      )}

      {/* flex-wrap + flex-auto: a third button that doesn't fit drops to its own full-width row. */}
      <div className="flex flex-wrap gap-2">
        {setupComplete && (
          // Once clicked for this posting it turns white and stays disabled: "Regenerate" under the
          // draft is the way to get another one. A different posting clears `coverLetter`, which re-arms it.
          <Button
            className="flex-auto"
            variant={generating || coverLetter ? "outline" : "default"}
            onClick={handleGenerate}
            disabled={locked || Boolean(coverLetter) || !job.position}
            title={generating ? undefined : lockedTitle}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("common.generating")}
              </>
            ) : coverLetter ? (
              t("main.coverLetterGenerated")
            ) : (
              t("main.generateCoverLetter")
            )}
          </Button>
        )}
        <Button className="flex-auto" onClick={() => void runAutofill(setupComplete)} disabled={locked} title={lockedTitle}>
          {autofilling && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("main.autofill")}
        </Button>
        {setupComplete && cvMeta && (
          <Button className="flex-auto" variant="outline" onClick={onOpenCvAdapt} disabled={locked} title={lockedTitle}>
            <FileUser className="h-4 w-4" /> {t("nav.adaptCv")}
          </Button>
        )}
      </div>

      {googleConnected && job.url && (job.position || job.company) && (
        <MarkAppliedButton
          application={existingApplication}
          suggested={Boolean(coverLetter) && !generating}
          busy={markingApplied || locked}
          onMark={() => void handleMarkApplied()}
        />
      )}

      <AgentApplyButton job={job} url={tabUrl} />

      {setupComplete && job.contact && (
        <Button
          variant="outline"
          onClick={() => void handleGenerateOutreach()}
          disabled={generatingOutreach}
        >
          <Mail className="h-4 w-4" />
          {generatingOutreach ? t("main.drafting") : t("main.generateOutreach")}
        </Button>
      )}
      {outreachError && <p className="text-xs text-destructive">{outreachError}</p>}

      {outreachMessage && (
        <div className="flex flex-col overflow-hidden rounded-md border border-border">
          <div className="flex items-center justify-between bg-muted/50 px-3 py-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("main.outreachMessage")}</p>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => void handleCopyOutreachMessage()}>
                {outreachCopied ? t("common.copied") : t("common.copy")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void handleGenerateOutreach()} disabled={generatingOutreach}>
                {generatingOutreach ? t("main.drafting") : t("common.regenerate")}
              </Button>
              {job.contact && (
                <a
                  href={outreachContactHref(job.contact, outreachMessage)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:bg-muted"
                >
                  {isEmailAddress(job.contact) ? t("main.openGmail") : t("main.openLinkedIn")}
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-3 px-4 py-4 text-sm leading-relaxed">
            {outreachMessage.subject !== null && (
              <input
                className="w-full border-b border-border bg-transparent pb-2 font-semibold outline-none"
                aria-label={t("main.subject")}
                placeholder={t("main.subject")}
                value={outreachMessage.subject}
                onChange={(e) => setOutreachMessage({ ...outreachMessage, subject: e.target.value })}
              />
            )}
            <textarea
              className="w-full resize-none bg-transparent outline-none"
              aria-label={t("main.message")}
              value={outreachMessage.body}
              ref={(el) => {
                if (el) {
                  el.style.height = "auto";
                  el.style.height = `${el.scrollHeight}px`;
                }
              }}
              onChange={(e) => setOutreachMessage({ ...outreachMessage, body: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2 border-t border-border bg-muted/30 p-2">
            <textarea
              rows={1}
              className="min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none"
              placeholder={t("main.outreachImprovePlaceholder")}
              value={outreachImproveInstructions}
              onChange={(e) => setOutreachImproveInstructions(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleImproveOutreach();
                }
              }}
            />
            <Button
              size="sm"
              onClick={() => void handleImproveOutreach()}
              disabled={improvingOutreach || !outreachImproveInstructions.trim()}
            >
              {improvingOutreach ? t("main.improving") : t("common.apply")}
            </Button>
          </div>
        </div>
      )}
      {!cvMeta && (
        <p className="text-xs text-muted-foreground">
          {t("main.noCv")}{" "}
          <button onClick={onOpenSettings} className="underline underline-offset-2">
            {t("main.addCvInSettings")}
          </button>
        </p>
      )}
      {autofillStatus && <p className="text-xs text-muted-foreground">{autofillStatus}</p>}

      {coverLetter && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <DraggableValue value={coverLetter} onDragStart={handleCoverLetterDragStart}>
              <p className="text-sm font-medium">{t("main.coverLetter")}</p>
            </DraggableValue>
            <span className="text-xs text-muted-foreground">
              {driveSaveStatus === "saving" && t("main.savingToDrive")}
              {driveSaveStatus === "saved" && t("main.savedToDrive")}
              {driveSaveStatus === "error" && t("main.driveSaveFailed")}
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
              {t("main.draft")}
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
              {t("main.translate")}{translatingLanguages.size > 0 && "…"}
            </button>
          </div>

          {coverLetterTab === "draft" ? (
            <>
              <p className="text-xs text-muted-foreground">
                <GripVertical className="mb-0.5 inline h-3 w-3" /> {t("main.dragCoverLetter")}
              </p>
              {cleanedNotice && <p className="text-xs text-muted-foreground">{cleanedNotice}</p>}
              <Suspense fallback={<EditorFallback />}>
                <CoverLetterEditor content={coverLetter} onChange={handleCoverLetterChange} />
              </Suspense>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerate} disabled={locked} title={lockedTitle}>
                  {generating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t("common.regenerate")}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleExportPdf(coverLetter)}
                  disabled={generating || improving || !coverLetter}
                >
                  {t("main.exportPdf")}
                </Button>
              </div>
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
                <p className="text-xs font-medium">{t("main.improve")}</p>
                <textarea
                  className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
                  placeholder={t("main.improvePlaceholder")}
                  value={improveInstructions}
                  onChange={(e) => setImproveInstructions(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleImprove}
                  disabled={locked || !improveInstructions.trim()}
                  title={improving ? undefined : lockedTitle}
                >
                  {improving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {improving ? t("main.improving") : t("common.apply")}
                </Button>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {targetLanguages.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {targetLanguages.map((language) => (
                    <button
                      key={language}
                      onClick={() => setActiveTranslationLanguage(language)}
                      className={cn(
                        "rounded-full px-2 py-0.5 text-xs font-medium",
                        language === effectiveActiveLanguage
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {language}
                      {translatingLanguages.has(language) && "…"}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("main.translateHint")}
              </p>
              <Select value={translateLanguage} onChange={(e) => void handleTranslateLanguageChange(e.target.value)}>
                {LANGUAGES.map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </Select>
              {translations[effectiveActiveLanguage] ? (
                <>
                  <DraggableValue value={translations[effectiveActiveLanguage]}>
                    <p className="text-xs text-muted-foreground">{t("main.dragAsText")}</p>
                  </DraggableValue>
                  <Suspense fallback={<EditorFallback />}>
                    <CoverLetterEditor
                      content={translations[effectiveActiveLanguage]}
                      onChange={(text) =>
                        setTranslations((prev) => ({ ...prev, [effectiveActiveLanguage]: text }))
                      }
                    />
                  </Suspense>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void handleExportPdf(translations[effectiveActiveLanguage], effectiveActiveLanguage)
                    }
                    disabled={generating || translatingLanguages.has(effectiveActiveLanguage)}
                  >
                    {t("main.exportPdf")}
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translatingLanguages.has(effectiveActiveLanguage)
                    ? t("main.translating")
                    : t("main.translationSoon")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {setupComplete && (
        <div>
          <p className="text-sm font-medium">{t("main.applicationQuestions")}</p>
          {/* Same gradient the on-page picker overlay draws around a picked block
              (element-picker.ts) — so the button itself visually promises what
              clicking it does to the page, instead of blending in as one more
              outline button. */}
          <div className="mt-1.5 rounded-md p-[2px]" style={{ background: PICKER_GRADIENT }}>
            {picking ? (
              <Button
                size="lg"
                variant="outline"
                className="w-full rounded-[5px] border-0"
                onClick={handleStopPicker}
              >
                {t("main.stopPicking")}
                <kbd className="ml-1.5 rounded border px-1 text-[10px] font-medium opacity-70">
                  {PICKER_HOTKEY_LABEL}
                </kbd>
              </Button>
            ) : (
              <Button
                size="lg"
                variant="outline"
                className="w-full rounded-[5px] border-0"
                onClick={() => void handleStartPicker()}
                disabled={locked}
                title={lockedTitle}
              >
                {t("main.pickFields")}
                <kbd className="ml-1.5 rounded border px-1 text-[10px] font-medium opacity-70">
                  {PICKER_HOTKEY_LABEL}
                </kbd>
              </Button>
            )}
          </div>
          {picking && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("main.pickerHint", { hotkey: PICKER_HOTKEY_LABEL })}
            </p>
          )}
          {customQuestions.length > 0 && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {answeringAllQuestions
                  ? t("main.answeringQuestions")
                  : t("main.answeredQuestions")}
              </p>
              <ul className="mt-1 flex flex-col gap-2">
                {customQuestions.map((q) => {
                  const { id, question, options } = q;
                  const answer = questionAnswers[questionAnswerKey(q)];
                  const insufficientInfo = insufficientInfoQuestions.has(questionAnswerKey(q));
                  return (
                    <li key={id} className="flex flex-col gap-1 rounded-md border border-border p-2">
                      <p className="text-sm">{question}</p>
                      {options && options.length > 0 && (
                        <p className="text-xs text-muted-foreground">{t("main.chooseOne", { options: options.join(" · ") })}</p>
                      )}
                      {answer ? (
                        <DraggableValue value={answer} className="text-sm text-muted-foreground">
                          <span>{answer}</span>
                        </DraggableValue>
                      ) : insufficientInfo ? (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          {t("main.notEnoughInfo")}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {answeringAllQuestions
                            ? t("common.generating")
                            : hasApiKey
                              ? t("main.noAnswerYet")
                              : t("main.noAnswerNoKey")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {unfillableQuestions.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("main.unfillable", { questions: unfillableQuestions.join(", ") })}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={manualQuestionText}
              onChange={(e) => setManualQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddManualQuestion();
              }}
              placeholder={t("main.manualQuestionPlaceholder")}
              className="h-8 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAddManualQuestion()}
              disabled={addingManualQuestion || !manualQuestionText.trim()}
            >
              {t("common.add")}
            </Button>
          </div>
        </div>
      )}
      {setupComplete && detectingQuestions && (
        <p className="text-xs text-muted-foreground">{t("main.scanningQuestions")}</p>
      )}

      {/* Consent checkboxes are decided and ticked on the page automatically
          (handleAnalyzePageContent) — no need to also list them here; the user
          reviews/changes them directly on the form like any other field. */}

      <div>
        <p className="text-sm font-medium">{t("main.profile")}</p>
        <p className="text-xs text-muted-foreground">
          <GripVertical className="mb-0.5 inline h-3 w-3" /> {t("main.dragProfile")}
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {PROFILE_FIELDS.map((key) => (
            <DraggableValue key={key} value={profile[key]} variant="card">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(`profile.${key}`)}
              </span>
              <span
                className={cn("mt-0.5 block truncate text-sm", !profile[key] && "text-muted-foreground")}
                title={profile[key] || undefined}
              >
                {formatProfileValueForDisplay(key, profile[key]) || "—"}
              </span>
            </DraggableValue>
          ))}
        </div>
      </div>

      {setupComplete && customFields.length > 0 && (
        <div>
          <p className="text-sm font-medium">{t("main.customFields")}</p>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> {t("main.dragCustomFields")}
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {customFields.map((field) => (
              <DraggableValue key={field.id} value={field.value} variant="card">
                <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </span>
                <span
                  className={cn("mt-0.5 block truncate text-sm", !field.value && "text-muted-foreground")}
                  title={field.value || undefined}
                >
                  {field.value || "—"}
                </span>
              </DraggableValue>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 rounded-md border border-border p-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t("main.password")}</p>
          <Button size="sm" variant="outline" onClick={() => void handleGeneratedPassword(generatePassword())}>
            {t("common.regenerate")}
          </Button>
        </div>
        {generatedPassword ? (
          <DraggableValue value={generatedPassword} className="text-sm">
            <button
              type="button"
              onClick={() => void handleCopyGeneratedPassword()}
              className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono hover:bg-muted"
              title={t("main.clickToCopy")}
            >
              {passwordCopied ? t("common.copied") : generatedPassword}
            </button>
          </DraggableValue>
        ) : (
          <p className="text-xs text-muted-foreground">{t("common.generating")}</p>
        )}
      </div>

      {(cvMeta || coverLetter) && (
        <div>
          <p className="text-sm font-medium">{t("main.attachments")}</p>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> {t("main.dragAttachments")}
          </p>
          <div className="mt-1.5 flex gap-2">
            {cvMeta && (
              <AttachmentIcon
                label={t("main.cv")}
                ready={cvFileReady && !locked}
                onDragStart={handleCvDragStart}
                onActivate={() => {
                  if (!locked) void handleAttachCvToPage();
                }}
              />
            )}
            {coverLetter && (
              <AttachmentIcon
                label={t("main.coverLetter")}
                ready={coverLetterFileReady && !locked}
                onDragStart={handleCoverLetterDragStart}
                onActivate={() => {
                  if (!locked) void handleUploadCoverLetterToPage();
                }}
              />
            )}
          </div>
          {adaptTemplate && (
            <div className="mt-2 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={locked} title={lockedTitle} onClick={() => void handleAdaptedCv("preview")}>
                  <Eye className="h-3.5 w-3.5" /> {t("main.previewAdaptedCv")}
                </Button>
                <Button size="sm" variant="outline" disabled={locked} title={lockedTitle} onClick={() => void handleAdaptedCv("attach")}>
                  <Paperclip className="h-3.5 w-3.5" /> {t("main.attachAdaptedCv")}
                </Button>
                <Button size="sm" variant="ghost" disabled={locked} title={lockedTitle} onClick={() => void handleAdaptedCv("download")}>
                  <Download className="h-3.5 w-3.5" /> {t("main.exportAdaptedCv")}
                </Button>
                <button onClick={onOpenCvAdapt} className="text-xs text-muted-foreground underline underline-offset-2">
                  {t("main.adjust")}
                </button>
              </div>
              {adaptStatus && <p className="text-xs text-muted-foreground">{adaptStatus}</p>}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

/**
 * A file drag source rendered as a `div`, not a `button`: native `<button>`
 * elements are a well-documented HTML5 drag-and-drop pitfall — `dragstart`
 * only reliably fires when the grab starts on the button's actual content,
 * not its padding, and behavior is inconsistent across engines. A styled
 * `div` with `role="button"` is the pattern this codebase already relies on
 * elsewhere (DraggableValue, for the Cover Letter/Profile drags) and is the
 * standard workaround.
 */
function AttachmentIcon({
  label,
  ready,
  onDragStart,
  onActivate,
}: {
  label: string;
  /** Whether the underlying File has actually finished loading. Gating
   * `draggable` on this (rather than always allowing drag and bailing out
   * inside the handler) matters: once a `dragstart` fires with nothing
   * attached, the browser doesn't just do nothing — it falls back to
   * dragging the element's own visible text, which looks like a successful
   * drag but silently delivers a filename instead of a file. Not being
   * draggable yet prevents that fallback from ever kicking in. */
  ready: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onActivate: () => void;
}) {
  const t = useT();
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={ready}
      onDragStart={onDragStart}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      title={ready ? t("main.attachmentReady", { label }) : t("main.attachmentLoading", { label })}
      className={cn(
        "flex flex-1 flex-col items-center gap-1 rounded-md border border-border p-2 text-xs text-muted-foreground hover:bg-muted",
        ready ? "cursor-grab active:cursor-grabbing" : "cursor-wait opacity-60",
      )}
    >
      <FileText className="h-5 w-5" />
      {label}
    </div>
  );
}

/**
 * Looks like `Field` until hovered/focused — extraction occasionally gets a
 * title wrong (a fused "Role at Company", an SEO headline), and the fix
 * should be one click away, not behind "Show job text". Enter or leaving
 * the field commits.
 */
function EditableField({
  label,
  value,
  loading,
  onChange,
  onCommit,
}: {
  label: string;
  value: string;
  loading: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  const t = useT();
  const id = `job-field-${label.toLowerCase()}`;
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {loading ? (
        <p className="text-sm">{t("common.loading")}</p>
      ) : (
        <div className="group relative -mx-1.5">
          <input
            id={id}
            value={value}
            placeholder="—"
            title={t("main.clickToCorrect")}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 pr-6 text-sm outline-none placeholder:text-foreground hover:border-border focus:border-border focus-visible:ring-1 focus-visible:ring-primary"
          />
          <Pencil
            aria-hidden
            className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-0"
          />
        </div>
      )}
    </div>
  );
}

/** "Mark as applied" — once done, shows how long the application took instead. */
function MarkAppliedButton({
  application,
  busy,
  suggested,
  onMark,
}: {
  application: Application | null;
  busy: boolean;
  /** A cover letter is ready — applying is the likely next step, so the button is drawn filled. */
  suggested: boolean;
  onMark: () => void;
}) {
  const t = useT();
  if (application?.status === "applied" && application.timing) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {t("main.appliedIn", { duration: formatDuration(application.timing.durationMs) })}
      </p>
    );
  }
  return (
    <Button variant={suggested ? "default" : "outline"} className="w-full" onClick={onMark} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
      {t("main.markApplied")}
    </Button>
  );
}
