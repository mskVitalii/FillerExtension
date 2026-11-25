import { currentProjectId } from "@/features/projects/scope";
import type { Job, JobBrief, JobKeyword, JobLanguageInfo } from "./job";
import type { CvMeta, FaqEntry, Profile } from "./profile";
import type { CvChoice } from "@/features/cv-selection/select";
import type { CvTemplate, CvValueSuggestion } from "./cv-template";
import type { JobSearchProvider, JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "./job-search";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { CatchAllContext } from "@/features/autofill/catch-all";
import type { PickedField, FieldDescriptor } from "@/features/autofill/pick-questions";
import type { ElementLocator } from "@/features/autofill/element-locator";
import type { PageCheckbox, CheckboxDecisionInput } from "@/features/autofill/checkboxes";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import type { InsertField } from "@/features/autofill/insert-field-labels";
import type { DateInputKind } from "@/lib/date-format";
import type { FillRun } from "@/features/fill-stats/stats";
import type { FieldDecisionRequest, FieldDecisionResult } from "@/features/autofill/ai-assist";
import type { LinkedInJobLink } from "@/features/linkedin-collector/links";

/**
 * Typed runtime message protocol shared by Side Panel, Background Service
 * Worker and Content Script. Every message is a discriminated union member
 * on `type` — never send arbitrary/untyped payloads (spec section 21).
 */
export type RuntimeMessage =
  | { type: "GET_JOB"; tabId: number; force?: boolean }
  | {
      type: "JOB_DATA";
      job: Job;
      sufficient: boolean;
      visibleText?: string;
      /** Set only when this job came from the merged AI extraction+brief call (the DOM-insufficient
       * fallback, or a pasted-text extraction) — the brief is already done, so the Side Panel skips
       * the separate DETECT_JOB_BRIEF round trip it would otherwise send right after. */
      brief?: JobBrief;
      /** The tab's URL, set on a DOM-insufficient answer — the key the Side Panel caches the
       * completed job under once `COMPLETE_JOB` returns. */
      pageUrl?: string;
    }
  | { type: "EXTRACT_JOB_FROM_TEXT"; tabId: number; text: string }
  /** Fills what a DOM-insufficient `GET_JOB` missed (AI), from that answer's job and visible text. */
  | { type: "COMPLETE_JOB"; job: Job; text: string }
  | { type: "GET_PROFILE" }
  | { type: "PROFILE_DATA"; profile: Profile }
  | { type: "AUTOFILL"; tabId: number; profile: Profile }
  | { type: "AUTOFILL_RESULT"; filled: number; total: number; generatedPassword: string | null }
  /** Content script → background, once an Autofill's refill guard settled: what happened to each profile field. */
  | { type: "FILL_STATS_REPORT"; run: FillRun }
  /**
   * Content script → background, during an Autofill: the AI pass's batched Decisions questions
   * (dropdowns no option matched offline, fields the detector couldn't classify). Answered with
   * FIELD_DECISIONS, or ERROR without a key — then the offline fill stands as it is.
   */
  | { type: "DECIDE_FIELDS"; request: FieldDecisionRequest }
  | { type: "FIELD_DECISIONS"; result: FieldDecisionResult }
  | { type: "INSERT_VALUE"; field: InsertField; value: string }
  | { type: "GENERATE_COVER_LETTER"; tabId: number; job: Job; postingLanguage?: string }
  | { type: "COVER_LETTER_RESULT"; content: string; slopFindings: SlopFinding[]; cleaned: boolean }
  /** One-way broadcast (background -> Side Panel) per streamed token chunk while a
   * GENERATE_COVER_LETTER request is in flight — `COVER_LETTER_RESULT` above still carries the
   * final, authoritative (possibly AI-slop-cleaned) content once the request resolves. Carries
   * `tabId` because `chrome.runtime.sendMessage` broadcasts to every extension page; a Side
   * Panel open on a different tab must ignore chunks that aren't its own. */
  | { type: "COVER_LETTER_STREAM_CHUNK"; tabId: number; delta: string }
  /** Broadcast by the background after a toolbar-icon click injected the content script into
   * `tabId` — a Side Panel that already showed that tab as unreadable retries its extraction. */
  | { type: "TAB_ACCESS_GRANTED"; tabId: number }
  | {
      type: "UPLOAD_FILE";
      tabId: number;
      kind: "cv" | "coverLetter";
      fileName: string;
      mimeType: string;
      base64Data: string;
      /** When set, inject only into this element (a field the user dropped onto) instead of scanning the whole page. */
      targetLocator?: ElementLocator | null;
    }
  | { type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }
  | { type: "ATTACH_FILE_AT"; kind: "cv" | "coverLetter"; locator: ElementLocator | null }
  | { type: "EXPORT_PDF"; content: string; fileName: string }
  | { type: "REVISE_COVER_LETTER"; job: Job; content: string; instructions: string }
  | { type: "REVISE_COVER_LETTER_RESULT"; content: string }
  | { type: "TRANSLATE_COVER_LETTER"; content: string; targetLanguage: string }
  | { type: "TRANSLATE_COVER_LETTER_RESULT"; content: string }
  | { type: "GENERATE_OUTREACH_MESSAGE"; tabId: number; job: Job; contact: string; postingLanguage?: string }
  | { type: "OUTREACH_MESSAGE_RESULT"; subject: string | null; body: string }
  | { type: "REVISE_OUTREACH_MESSAGE"; job: Job; subject: string | null; body: string; instructions: string }
  /** Cross-origin iframes on the tab the content script can't reach yet (no host permission for them). */
  | { type: "GET_FRAME_ACCESS"; tabId: number }
  | { type: "FRAME_ACCESS"; blockedOrigins: string[] }
  | { type: "DETECT_CUSTOM_QUESTIONS"; tabId: number }
  | { type: "CUSTOM_QUESTIONS_DATA"; questions: CustomQuestion[] }
  | {
      type: "ANSWER_CUSTOM_QUESTION";
      question: string;
      job: Job;
      options?: string[];
      /** True for a "select all that apply" checkbox-group question — the answer may name more than one option. */
      multi?: boolean;
      numeric?: boolean;
      dateKind?: DateInputKind;
      /** The job posting's detected language (JobLanguageInfo.postingLanguages[0]) — the answer is written in it when given. */
      postingLanguage?: string;
      /** For a catch-all field (`CustomQuestion.catchAll`): what the form says about it. Absent = judged by the label alone. */
      catchAll?: CatchAllContext;
    }
  | {
      type: "CUSTOM_QUESTION_ANSWER";
      question: string;
      answer: string;
      /** False when the model reports the profile/CV/etc genuinely lack what this question asks for (spec_8 item 6) — the Side Panel shows this as a distinct "not enough info" state instead of a plain empty answer. */
      sufficientInfo: boolean;
    }
  | { type: "FILL_CUSTOM_QUESTION_ANSWERS"; tabId: number; answers: Record<string, string> }
  | { type: "CUSTOM_QUESTION_FILL_RESULT"; filled: number; unfilled: string[] }
  | { type: "START_ELEMENT_PICKER"; tabId: number }
  | { type: "CANCEL_ELEMENT_PICKER"; tabId: number }
  | {
      type: "ELEMENT_PICKER_RESULT";
      cancelled: boolean;
      picked: PickedField[];
      blockText: string;
      semanticCount: number;
    }
  | { type: "DECOMPOSE_BLOCK"; blockText: string; fields: FieldDescriptor[] }
  | { type: "BLOCK_QUESTIONS"; questions: Record<number, string> }
  | {
      type: "FILL_QUESTION_ANSWERS_BY_LOCATOR";
      tabId: number;
      items: { locator: ElementLocator; answer: string; question?: string }[];
    }
  | { type: "DETECT_CHECKBOXES"; tabId: number }
  | { type: "CHECKBOXES_DATA"; checkboxes: PageCheckbox[] }
  /**
   * One AI call that decides every consent checkbox and answers every pending custom question
   * found on the page at panel-open time — a checkbox-decision call plus one parallel call per
   * question would cost more simultaneous requests against the user's own OpenAI rate limit for
   * no latency benefit (those ran in parallel already). `questions` should already be filtered
   * down to the ones genuinely still unanswered; a later single question (manual add, picker)
   * still goes through ANSWER_CUSTOM_QUESTION on its own.
   */
  | {
      type: "DECIDE_PAGE_CONTENT";
      checkboxes: PageCheckbox[];
      questions: CustomQuestion[];
      job: Job;
      postingLanguage?: string;
    }
  | {
      type: "PAGE_CONTENT_DECISIONS";
      checkboxDecisions: CheckboxDecision[];
      /** Keyed by `CustomQuestion.id`, not position — same answer shape as CUSTOM_QUESTION_ANSWER. */
      questionAnswers: { id: string; answer: string; sufficientInfo: boolean }[];
    }
  | { type: "APPLY_CHECKBOX_DECISIONS"; tabId: number; decisions: CheckboxDecisionInput[] }
  | { type: "CHECKBOX_APPLY_RESULT"; changed: number }
  | { type: "DETECT_JOB_BRIEF"; job: Job }
  | { type: "JOB_BRIEF_DATA"; language: JobLanguageInfo; keywords: JobKeyword[]; contact: string | null }
  | { type: "HIGHLIGHT_KEYWORDS"; tabId: number; keywords: JobKeyword[] }
  | { type: "CLEAR_KEYWORD_HIGHLIGHTS"; tabId: number }
  | { type: "KEYWORD_HIGHLIGHT_RESULT"; matched: number }
  | { type: "GENERATE_FAQ_ANSWERS"; questions: string[] }
  | { type: "FAQ_ANSWERS_RESULT"; entries: FaqEntry[] }
  | {
      type: "SEARCH_JOBS";
      query: JobSearchQuery;
      page?: number;
      excludeResults?: JobSearchResult[];
      /** Echoed on `JOB_SEARCH_PROGRESS`, so the panel can tell this search's partial results from a stale one's. */
      searchId?: string;
    }
  /** Background → panel broadcast while a search runs: results already in (OpenAI per posting, Adzuna per tag), ahead of the final `JOB_SEARCH_RESULTS`. */
  | { type: "JOB_SEARCH_PROGRESS"; searchId: string; results: JobSearchResult[] }
  | {
      type: "JOB_SEARCH_RESULTS";
      results: JobSearchResult[];
      resolvedQuery: JobSearchQuery;
      /** Adzuna only: one message per search tag whose request failed (spec_7 item 13) — a partial-results notice, not a hard error. */
      warnings?: string[];
      /** Wall-clock duration of the whole search, as measured in the background. */
      totalMs: number;
      /** Per-step breakdown (e.g. web search vs. AI parse) — `totalMs` also covers the untimed glue between them. */
      stages: JobSearchStageTiming[];
    }
  /** LinkedIn collector (content script) → background: jobs the user clicked "Add" on, re-validated there. */
  | { type: "LINKEDIN_ADD_JOBS"; jobs: LinkedInJobLink[] }
  | { type: "LINKEDIN_JOBS_ADDED"; added: number; total: number; ids: string[] }
  /** LinkedIn collector → background: which job ids are already collected (to mark their cards "Added"). */
  | { type: "GET_LINKEDIN_COLLECTED" }
  | { type: "LINKEDIN_COLLECTED"; ids: string[] }
  /** Side Panel → background → the tab's top frame: the employer link behind LinkedIn's "Apply" button ("" for Easy Apply). */
  | { type: "GET_LINKEDIN_APPLY_URL"; tabId: number }
  | { type: "LINKEDIN_APPLY_URL"; url: string }
  /** Background → LinkedIn tabs: the collector was switched off, take the on-page buttons down. */
  | { type: "LINKEDIN_COLLECTOR_OFF" }
  /** Side Panel → background: the employer's own posting (career site / ATS) for a job collected on LinkedIn. */
  | { type: "FIND_EMPLOYER_POSTING"; title: string; company: string; location: string }
  | { type: "EMPLOYER_POSTING_CANDIDATES"; candidates: JobSearchResult[] }
  | { type: "SUGGEST_SEARCH_QUERY"; provider?: JobSearchProvider }
  | { type: "SEARCH_QUERY_SUGGESTION"; what: string; where: string; tags?: string[] }
  | { type: "SUGGEST_CV_VALUES"; job: Job; template: CvTemplate }
  | { type: "CV_VALUES"; values: CvValueSuggestion[] }
  /** "Let AI choose the CV": the support model picks one of `cvs` for `job` — null keeps the offline pick. */
  | { type: "CHOOSE_CV"; job: Job; cvs: CvMeta[]; postingLanguage?: string }
  | { type: "CV_CHOICE"; choice: CvChoice | null }
  /** Background reply when `routeMessage` threw — `sendMessage` rethrows it as an Error. */
  | { type: "ERROR"; error: string; code?: string };

export type RuntimeMessageType = RuntimeMessage["type"];

/** The `RuntimeMessage` member for one `type` — use it for a response type instead of restating its fields. */
export type MessageOf<T extends RuntimeMessageType> = Extract<RuntimeMessage, { type: T }>;

/** The project a request was sent from (`sendMessage` stamps it), so the background runs it there. */
export type ProjectStamped<M> = M & { projectId?: string };

export async function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  // The Side Panel is bound to its project for life (it reloads on a switch), so the background
  // runs this request in that project even if the user switches while it's still running.
  const stamped: ProjectStamped<RuntimeMessage> = { ...message, projectId: await currentProjectId() };
  const response = (await chrome.runtime.sendMessage(stamped)) as T | Extract<RuntimeMessage, { type: "ERROR" }>;
  if (response && typeof response === "object" && (response as { type?: string }).type === "ERROR") {
    const { error, code } = response as Extract<RuntimeMessage, { type: "ERROR" }>;
    const err = new Error(error || "Background request failed.");
    if (code) err.name = code;
    throw err;
  }
  return response as T;
}
