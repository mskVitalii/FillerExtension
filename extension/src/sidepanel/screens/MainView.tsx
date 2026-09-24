import { useEffect, useRef, useState, Suspense, lazy, type DragEvent } from "react";
import { FileText, GripVertical, ListChecks, RotateCcw, Search, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DraggableValue } from "@/components/DraggableValue";
import { SetupBanner } from "@/components/SetupBanner";
// TipTap + ProseMirror (~200 kB) load only once a cover letter exists and
// the editor actually renders — kept out of the Side Panel's initial bundle.
const CoverLetterEditor = lazy(() =>
  import("@/components/cover-letter/Editor").then((m) => ({ default: m.CoverLetterEditor })),
);
const EditorFallback = () => (
  <p className="text-xs text-muted-foreground">Loading editor…</p>
);
import { EMPTY_JOB, type Job, type JobKeyword, type JobLanguageInfo } from "@/types/job";
import type { CustomField, CvMeta, LanguageLevel, Profile } from "@/types/profile";
import { meetsLevel } from "@/lib/language-level";
import { sendMessage, type RuntimeMessage } from "@/types/messages";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { formatProfileValueForDisplay } from "@/features/profile/format-value";
import { downloadFile, renderCoverLetterPdf } from "@/features/pdf/export";
import { fileToBase64 } from "@/lib/base64";
import { recordUrlActivation, setLocal } from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { clearTabState, getTabState, setTabState } from "@/features/storage/session";
import { getApplicationByUrl, saveCoverLetterDraft } from "@/features/applications/repository";
import type { Application } from "@/types/application";
import { getCvFile } from "@/features/profile/repository";
import { questionAnswerKey, type CustomQuestion } from "@/features/autofill/custom-questions";
import type { PickedField } from "@/features/autofill/pick-questions";
import type { ElementLocator } from "@/features/autofill/element-locator";
import type { PageCheckbox } from "@/features/autofill/checkboxes";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import { LANGUAGES } from "@/lib/languages";
import { generatePassword } from "@/lib/generate-password";
import { cn } from "@/lib/utils";

/**
 * Toggles "Pick fields on page" from the keyboard while the Side Panel is
 * focused — press once to start, again to stop. Alt+P has no default action
 * in the panel and `preventDefault` stops it typing a character.
 */
const PICKER_HOTKEY_LABEL =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform) ? "⌥P" : "Alt+P";

/** Kept identical to the gradient `element-picker.ts` draws around a picked block on the page. */
const PICKER_GRADIENT = "linear-gradient(120deg, #6366f1, #22d3ee, #a855f7, #ec4899)";

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
  onOpenJobSearch: () => void;
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
  onOpenJobSearch,
  onRequestApiKey,
  onRequestGoogleConnect,
}: MainViewProps) {
  // Gates every AI-only and Drive-only section of the panel (spec_8): with
  // either missing, cover letters/auto-answers/keyword highlighting/job
  // search/saved applications can't work, so hiding them instead of letting
  // them silently error keeps the panel down to what actually works —
  // extraction + Autofill Application, neither of which needs either.
  const setupComplete = hasApiKey && googleConnected;
  const [job, setJob] = useState<Job>(EMPTY_JOB);
  const [loadingJob, setLoadingJob] = useState(true);
  // spec_7 item 8 — a previously-saved Drive record for the current job URL,
  // surfaced as a badge so re-opening a posting already applied to is
  // obvious before generating a duplicate cover letter.
  const [existingApplication, setExistingApplication] = useState<Application | null>(null);
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
  // re-run `handleDecideCheckboxes` needlessly.
  const [checkboxDecisions, setCheckboxDecisions] = useState<CheckboxDecision[]>([]);

  const [showJobText, setShowJobText] = useState(false);
  const [jobLanguage, setJobLanguage] = useState<JobLanguageInfo | null>(null);
  const [jobKeywords, setJobKeywords] = useState<JobKeyword[]>([]);
  // On by default (spec_8 item 2: "make reading the posting cooler") — the
  // toggle just lets the user turn it back off if they don't like it, or
  // re-run it after `handleReset`.
  const [highlightOnPage, setHighlightOnPage] = useState(true);
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  const coverLetterFileRef = useRef<File | null>(null);
  const cvFileRef = useRef<File | null>(null);
  const knownUrlRef = useRef(tabUrl);
  const hasLoadedRef = useRef(false);
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
  const [coverLetterFileReady, setCoverLetterFileReady] = useState(false);

  // Keeps a real File ready for native drag-and-drop (see handleCvDragStart)
  // — dragstart must attach dataTransfer synchronously, and getCvFile() is
  // async (Drive round-trip), so it can't be fetched on demand at drag time.
  useEffect(() => {
    if (!cvMeta) {
      cvFileRef.current = null;
      setCvFileReady(false);
      return;
    }
    setCvFileReady(false);
    void getCvFile()
      .then((file) => {
        cvFileRef.current = file;
        setCvFileReady(Boolean(file));
      })
      .catch(() => setCvFileReady(false));
  }, [cvMeta]);

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
      void handleDetectJobBrief(newJob);
      void checkExistingApplication(newJob.url);
      const prefs = await getPreferences();
      if (prefs.autofillOnOpen) await runAutofill();
    }
    void handleDetectQuestions(newJob ?? job);
    void handleDecideCheckboxes();
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
      translations,
      activeTranslationLanguage,
      customQuestions,
      customQuestionAnswers: questionAnswers,
      checkboxDecisions,
      jobLanguage,
      generatedPassword,
    });
  }, [
    tabId,
    tabUrl,
    job,
    coverLetter,
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
        sendMessage<{ type: "TRANSLATE_COVER_LETTER_RESULT"; content: string }>({
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
    try {
      const response = await sendMessage<{ type: "JOB_DATA"; job: Job }>({ type: "GET_JOB", tabId, force });
      if (response?.job) {
        detectedJob = response.job;
        setJob(response.job);
        void handleDetectJobBrief(response.job);
        void checkExistingApplication(response.job.url);
        const prefs = await getPreferences();
        if (prefs.autofillOnOpen) await runAutofill();
      }
    } catch {
      setError("Could not read this page. Open a job posting tab, or paste the job text below.");
    } finally {
      setLoadingJob(false);
      hasLoadedRef.current = true;
    }
    void handleDetectQuestions(detectedJob);
    void handleDecideCheckboxes();
  }

  /**
   * Language detection + keyword extraction (spec_8 item 2) run automatically on every job
   * load, combined into one MODEL_LUNA call (`analyzeJobBrief`) instead of two independent
   * round trips over the same job/applicant context.
   */
  async function handleDetectJobBrief(currentJob: Job) {
    if (!hasApiKey) return;
    try {
      const response = await sendMessage<{ type: "JOB_BRIEF_DATA"; language: JobLanguageInfo; keywords: JobKeyword[] }>({
        type: "DETECT_JOB_BRIEF",
        job: currentJob,
      });
      setJobLanguage(response?.language ?? null);
      const keywords = response?.keywords ?? [];
      setJobKeywords(keywords);
      if (keywords.length > 0 && highlightOnPage) {
        await sendMessage({ type: "HIGHLIGHT_KEYWORDS", tabId, keywords }).catch(() => undefined);
      }
    } catch {
      // No API key yet, or the request failed — leave the brief/keyword list empty.
    }
  }

  function handleToggleHighlightOnPage() {
    setHighlightOnPage((prev) => {
      const next = !prev;
      if (next && jobKeywords.length > 0) {
        void sendMessage({ type: "HIGHLIGHT_KEYWORDS", tabId, keywords: jobKeywords }).catch(() => undefined);
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
          setError(`Couldn't answer the application questions: ${failures[0]}`);
        }
      }

      // Auto-detected questions are written back by matching their label
      // text on a re-scan; picker-added ones carry a locator instead, since
      // their field often has no question-shaped label to match.
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
        fills.push(
          sendMessage<FillResult>({ type: "FILL_QUESTION_ANSWERS_BY_LOCATOR", tabId, items: locatorItems }),
        );
      }
      const fillResults = await Promise.all(fills);
      setUnfillableQuestions(fillResults.flatMap((r) => r.unfilled));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not answer the application questions.");
    } finally {
      setAnsweringAllQuestions(false);
    }
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
      setError(err instanceof Error ? err.message : "Couldn't process that selection.");
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
        setError("No form fields in that selection — pick the block that contains the inputs (↑ widens it).");
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
      setError("Nothing question-shaped in that block — try a wider selection with ↑.");
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
      setError(err instanceof Error ? err.message : "Couldn't start the picker on this page.");
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
   * Consent / marketing checkboxes: detect on the page, let the AI decide
   * each (tick the mandatory privacy/terms consents, leave newsletters and
   * job-alert opt-ins off), then apply. Runs automatically on panel open —
   * the applicant is here to apply, so ticking the required boxes is what
   * they'd do by hand anyway.
   */
  async function handleDecideCheckboxes() {
    if (!hasApiKey) return;
    let checkboxes: PageCheckbox[] = [];
    try {
      const response = await sendMessage<{ type: "CHECKBOXES_DATA"; checkboxes: PageCheckbox[] }>({
        type: "DETECT_CHECKBOXES",
        tabId,
      });
      checkboxes = response?.checkboxes ?? [];
    } catch {
      return; // no content script on this page
    }
    if (checkboxes.length === 0) {
      setCheckboxDecisions([]);
      return;
    }

    try {
      const response = await sendMessage<{ type: "CHECKBOX_DECISIONS"; decisions: CheckboxDecision[] }>({
        type: "DECIDE_CHECKBOXES",
        checkboxes,
      });
      const decisions = response?.decisions ?? [];
      setCheckboxDecisions(decisions);
      if (decisions.length > 0) {
        await sendMessage<{ type: "CHECKBOX_APPLY_RESULT"; changed: number }>({
          type: "APPLY_CHECKBOX_DECISIONS",
          tabId,
          decisions: decisions.map((d) => ({ name: d.name, label: d.label, check: d.check })),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decide on the form's checkboxes.");
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
    setActiveTranslationLanguage(language);
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
        void handleDetectJobBrief(response.job);
      }
      setPasteMode(false);
      setPasteText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that job text.");
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
      if (message.type === "COVER_LETTER_STREAM_CHUNK" && message.tabId === tabId) {
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
    try {
      const response = await sendMessage<{
        type: "COVER_LETTER_RESULT";
        content: string;
        slopFindings: { pattern: string; match: string }[];
        cleaned: boolean;
      }>({ type: "GENERATE_COVER_LETTER", tabId, job, postingLanguage: jobLanguage?.postingLanguages[0] });
      setCoverLetter(response.content);
      if (job.url) void recordUrlActivation(job.url);
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

  /** `language` is a display name from `LANGUAGES` (e.g. "German") appended to the filename for a translated export. */
  async function handleExportPdf(content: string, language?: string) {
    try {
      const suffix = language ? ` (${language})` : "";
      const file = await renderCoverLetterPdf(content, `Cover Letter - ${job.company || "application"}${suffix}.pdf`);
      await downloadFile(file);
    } catch (err) {
      setError(err instanceof Error ? `PDF export failed: ${err.message}` : "PDF export failed.");
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
      const response = await sendMessage<{ type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }>({
        type: "UPLOAD_FILE",
        tabId,
        kind: "coverLetter",
        fileName: file.name,
        mimeType: file.type,
        base64Data,
        targetLocator,
      });
      setAutofillStatus(
        `Cover letter placed into ${response.nativeInputs} file input(s), ${response.dropZones} drop zone(s).`,
      );
    } catch (err) {
      setAutofillStatus(err instanceof Error ? `PDF export failed: ${err.message}` : "PDF export failed.");
    }
  }

  /** Pushes the CV already on file (Settings) into *this* page's file-upload
   * field — a per-application action, not the one-time "store my CV" step
   * that lives in Settings, so it stays here despite the similar name. */
  async function handleAttachCvToPage(targetLocator?: ElementLocator | null) {
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
      targetLocator,
    });
    setAutofillStatus(`CV placed into ${response.nativeInputs} file input(s), ${response.dropZones} drop zone(s).`);
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
      if (msg.kind === "cv") void handleAttachCvToPage(msg.locator ?? null);
      else if (msg.kind === "coverLetter") void handleUploadCoverLetterToPage(msg.locator ?? null);
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
   * bootstrap/navigation call sites already run `handleDetectQuestions`
   * once on their own right after `runAutofill()` — defaulting this to
   * `false` there avoids scanning (and re-answering via the model) twice
   * on every ordinary panel open. `answerAndFillQuestions` re-filters
   * against already-known answers regardless, so a rescan here never
   * re-asks the model about a question it already answered.
   */
  async function runAutofill(rescanQuestions = false) {
    setAutofillStatus(null);
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
      setAutofillStatus(`Filled ${response.filled} of ${response.total} detected fields.`);
      if (response.generatedPassword) await handleGeneratedPassword(response.generatedPassword);
      // spec_6 — only an actual fill counts as "worked this posting", not
      // every panel open (see recordUrlActivation's own doc comment).
      if (response.filled > 0 && job.url) void recordUrlActivation(job.url);
    } catch {
      setAutofillStatus("Autofill failed on this page.");
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

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold">Filler</h1>
        <div className="-mr-1.5 flex items-center gap-0.5">
          <IconButton onClick={() => void handleReset()} label="Reset">
            <RotateCcw />
          </IconButton>
          {setupComplete && (
            <>
              <IconButton onClick={onOpenJobSearch} label="Job search">
                <Search />
              </IconButton>
              <IconButton onClick={onOpenApplications} label="Applications">
                <ListChecks />
              </IconButton>
            </>
          )}
          <IconButton onClick={onOpenSettings} label="Settings">
            <Settings />
          </IconButton>
        </div>
      </div>

      <SetupBanner
        googleConnected={googleConnected}
        hasApiKey={hasApiKey}
        onConnectGoogle={onRequestGoogleConnect}
        onAddApiKey={onRequestApiKey}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {existingApplication && (
        <p className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
            Already applied
          </span>
          You generated a cover letter for this posting on{" "}
          {new Date(existingApplication.createdAt).toLocaleDateString()} (status: {existingApplication.status}) —{" "}
          <button onClick={onOpenApplications} className="underline underline-offset-2">
            view it
          </button>
          .
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 text-sm">
        <Field label="Company" value={job.company} loading={loadingJob} />
        <Field label="Position" value={job.position} loading={loadingJob} />
        <Field label="Location" value={job.location} loading={loadingJob} />
      </div>

      {setupComplete && (
        <>
          {jobLanguage && (jobLanguage.postingLanguages.length > 0 || jobLanguage.requirements.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {jobLanguage.postingLanguages.length > 0 && (
                <span className="text-muted-foreground">
                  Posting language: {jobLanguage.postingLanguages.join(", ")}
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
                    {req.language} {req.level ?? "level required"}
                  </span>
                );
              })}
            </div>
          )}

          {jobKeywords.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Keywords</p>
                <button
                  onClick={handleToggleHighlightOnPage}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  {highlightOnPage ? "Stop highlighting on page" : "Highlight on page"}
                </button>
              </div>
              <ul className="flex flex-wrap gap-1">
                {jobKeywords.map((kw) => (
                  <li
                    key={kw.text}
                    title={kw.matchesProfile ? "Matches your profile" : "Not found in your profile"}
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
        </>
      )}

      <div className="flex gap-2">
        {setupComplete && (
          <Button className="flex-1" onClick={handleGenerate} disabled={generating || !job.position}>
            {generating ? "Generating…" : "Generate Cover Letter"}
          </Button>
        )}
        <Button className="flex-1" onClick={() => void runAutofill(setupComplete)}>
          Autofill Application
        </Button>
      </div>
      {!cvMeta && (
        <p className="text-xs text-muted-foreground">
          No CV on file yet —{" "}
          <button onClick={onOpenSettings} className="underline underline-offset-2">
            add one in Settings
          </button>{" "}
          so it can be attached to applications.
        </p>
      )}
      {autofillStatus && <p className="text-xs text-muted-foreground">{autofillStatus}</p>}

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
              Translate{translatingLanguages.size > 0 && "…"}
            </button>
          </div>

          {coverLetterTab === "draft" ? (
            <>
              <p className="text-xs text-muted-foreground">
                <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto the page to insert as text, or onto a
                file upload zone to attach the PDF.
              </p>
              {cleanedNotice && <p className="text-xs text-muted-foreground">{cleanedNotice}</p>}
              <Suspense fallback={<EditorFallback />}>
                <CoverLetterEditor content={coverLetter} onChange={handleCoverLetterChange} />
              </Suspense>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating}>
                  Regenerate
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleExportPdf(coverLetter)}>
                  Export PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleUploadCoverLetterToPage()}>
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
                Auto-translated into every language from{" "}
                <span className="font-medium">Settings → My Languages</span>. Pick another one here for a one-off:
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
                    <p className="text-xs text-muted-foreground">Drag onto the page to insert as text.</p>
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
                  >
                    Export PDF
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translatingLanguages.has(effectiveActiveLanguage)
                    ? "Translating…"
                    : "Translation will appear here shortly."}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {setupComplete && (
        <div>
          <p className="text-sm font-medium">Application Questions</p>
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
                Stop picking
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
              >
                Pick fields on page
                <kbd className="ml-1.5 rounded border px-1 text-[10px] font-medium opacity-70">
                  {PICKER_HOTKEY_LABEL}
                </kbd>
              </Button>
            )}
          </div>
          {picking && (
            <p className="mt-1 text-xs text-muted-foreground">
              Click blocks on the page one after another — <kbd>↑</kbd>/<kbd>↓</kbd> resize the selection.
              Stays on until <kbd>Esc</kbd>, <kbd>{PICKER_HOTKEY_LABEL}</kbd>, or “Stop picking”.
            </p>
          )}
          {customQuestions.length > 0 && (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                {answeringAllQuestions
                  ? "Answering and filling these into the form…"
                  : "Answered automatically and filled into the form — edit and re-drag to change one."}
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
                        <p className="text-xs text-muted-foreground">Choose one: {options.join(" · ")}</p>
                      )}
                      {answer ? (
                        <DraggableValue value={answer} className="text-sm text-muted-foreground">
                          <span>{answer}</span>
                        </DraggableValue>
                      ) : insufficientInfo ? (
                        <p className="text-xs text-amber-600 dark:text-amber-500">
                          ⚠ Not enough info in your profile/CV to answer this — fill it in yourself.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {answeringAllQuestions
                            ? "Generating…"
                            : hasApiKey
                              ? "No answer yet — see the error above, or check the OpenAI request in this panel's devtools Network tab."
                              : "No answer yet — add your OpenAI key in Settings, then pick again."}
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
              Couldn't fill these fields automatically — please answer them yourself:{" "}
              {unfillableQuestions.join(", ")}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={manualQuestionText}
              onChange={(e) => setManualQuestionText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAddManualQuestion();
              }}
              placeholder="Type a question the picker/automation missed…"
              className="h-8 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleAddManualQuestion()}
              disabled={addingManualQuestion || !manualQuestionText.trim()}
            >
              Add
            </Button>
          </div>
        </div>
      )}
      {setupComplete && detectingQuestions && (
        <p className="text-xs text-muted-foreground">Scanning page for questions…</p>
      )}

      {/* Consent checkboxes are decided and ticked on the page automatically
          (handleDecideCheckboxes) — no need to also list them here; the user
          reviews/changes them directly on the form like any other field. */}

      <div>
        <p className="text-sm font-medium">Profile</p>
        <p className="text-xs text-muted-foreground">
          <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag a card onto the page to fill a single field.
        </p>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {PROFILE_FIELDS.map((key) => (
            <DraggableValue key={key} value={profile[key]} variant="card">
              <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {PROFILE_FIELD_LABELS[key]}
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
          <p className="text-sm font-medium">Custom Fields</p>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto the page — not filled by Autofill
            Application.
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
          <p className="text-sm font-medium">Password</p>
          <Button size="sm" variant="outline" onClick={() => void handleGeneratedPassword(generatePassword())}>
            Regenerate
          </Button>
        </div>
        {generatedPassword ? (
          <DraggableValue value={generatedPassword} className="text-sm">
            <button
              type="button"
              onClick={() => void handleCopyGeneratedPassword()}
              className="min-w-0 flex-1 truncate rounded px-1 py-0.5 text-left font-mono hover:bg-muted"
              title="Click to copy"
            >
              {passwordCopied ? "Copied!" : generatedPassword}
            </button>
          </DraggableValue>
        ) : (
          <p className="text-xs text-muted-foreground">Generating…</p>
        )}
      </div>

      {(cvMeta || coverLetter) && (
        <div>
          <p className="text-sm font-medium">Attachments</p>
          <p className="text-xs text-muted-foreground">
            <GripVertical className="mb-0.5 inline h-3 w-3" /> Drag onto a file drop zone on the page, or click to
            attach to a plain file input.
          </p>
          <div className="mt-1.5 flex gap-2">
            {cvMeta && (
              <AttachmentIcon
                label="CV"
                ready={cvFileReady}
                onDragStart={handleCvDragStart}
                onActivate={() => void handleAttachCvToPage()}
              />
            )}
            {coverLetter && (
              <AttachmentIcon
                label="Cover Letter"
                ready={coverLetterFileReady}
                onDragStart={handleCoverLetterDragStart}
                onActivate={() => void handleUploadCoverLetterToPage()}
              />
            )}
          </div>
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
      title={
        ready
          ? `${label} — drag onto a drop zone, or click to attach`
          : `${label} — still loading, click to attach (drag will be ready shortly)`
      }
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

function Field({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm">{loading ? "Loading…" : value || "—"}</p>
    </div>
  );
}
