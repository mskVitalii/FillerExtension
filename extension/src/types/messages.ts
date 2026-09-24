import type { Job, JobKeyword, JobLanguageInfo } from "./job";
import type { FaqEntry, Profile } from "./profile";
import type { CvTemplate, CvValueSuggestion, CvVariable } from "./cv-template";
import type { JobSearchProvider, JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "./job-search";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { PickedField, FieldDescriptor } from "@/features/autofill/pick-questions";
import type { ElementLocator } from "@/features/autofill/element-locator";
import type { PageCheckbox, CheckboxDecisionInput } from "@/features/autofill/checkboxes";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import type { InsertField } from "@/features/autofill/insert-field-labels";
import type { DateInputKind } from "@/lib/date-format";

/**
 * Typed runtime message protocol shared by Side Panel, Background Service
 * Worker and Content Script. Every message is a discriminated union member
 * on `type` — never send arbitrary/untyped payloads (spec section 21).
 */
export type RuntimeMessage =
  | { type: "GET_JOB"; tabId: number; force?: boolean }
  | { type: "JOB_DATA"; job: Job; sufficient: boolean; visibleText?: string }
  | { type: "EXTRACT_JOB_FROM_TEXT"; tabId: number; text: string }
  | { type: "GET_PROFILE" }
  | { type: "PROFILE_DATA"; profile: Profile }
  | { type: "AUTOFILL"; tabId: number; profile: Profile }
  | { type: "AUTOFILL_RESULT"; filled: number; total: number; generatedPassword: string | null }
  | { type: "INSERT_VALUE"; field: InsertField; value: string }
  | { type: "GENERATE_COVER_LETTER"; tabId: number; job: Job; postingLanguage?: string }
  | { type: "COVER_LETTER_RESULT"; content: string; slopFindings: SlopFinding[]; cleaned: boolean }
  /** One-way broadcast (background -> Side Panel) per streamed token chunk while a
   * GENERATE_COVER_LETTER request is in flight — `COVER_LETTER_RESULT` above still carries the
   * final, authoritative (possibly AI-slop-cleaned) content once the request resolves. Carries
   * `tabId` because `chrome.runtime.sendMessage` broadcasts to every extension page; a Side
   * Panel open on a different tab must ignore chunks that aren't its own. */
  | { type: "COVER_LETTER_STREAM_CHUNK"; tabId: number; delta: string }
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
  | { type: "DECIDE_CHECKBOXES"; checkboxes: PageCheckbox[] }
  | { type: "CHECKBOX_DECISIONS"; decisions: CheckboxDecision[] }
  | { type: "APPLY_CHECKBOX_DECISIONS"; tabId: number; decisions: CheckboxDecisionInput[] }
  | { type: "CHECKBOX_APPLY_RESULT"; changed: number }
  | { type: "DETECT_JOB_BRIEF"; job: Job }
  | { type: "JOB_BRIEF_DATA"; language: JobLanguageInfo; keywords: JobKeyword[] }
  | { type: "HIGHLIGHT_KEYWORDS"; tabId: number; keywords: JobKeyword[] }
  | { type: "CLEAR_KEYWORD_HIGHLIGHTS"; tabId: number }
  | { type: "KEYWORD_HIGHLIGHT_RESULT"; matched: number }
  | { type: "GENERATE_FAQ_ANSWERS"; questions: string[] }
  | { type: "FAQ_ANSWERS_RESULT"; entries: FaqEntry[] }
  | { type: "SEARCH_JOBS"; query: JobSearchQuery; page?: number; excludeResults?: JobSearchResult[] }
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
  | { type: "SUGGEST_SEARCH_QUERY"; provider?: JobSearchProvider }
  | { type: "SEARCH_QUERY_SUGGESTION"; what: string; where: string; tags?: string[] }
  | { type: "SUGGEST_CV_VALUES"; job: Job; template: CvTemplate }
  | { type: "CV_VALUES"; values: CvValueSuggestion[] }
  | { type: "TEMPLATIZE_CV"; cvText: string }
  | { type: "CV_TEMPLATE_DRAFT"; content: string; variables: CvVariable[] }
  /** Background reply when `routeMessage` threw — `sendMessage` rethrows it as an Error. */
  | { type: "ERROR"; error: string; code?: string };

export type RuntimeMessageType = RuntimeMessage["type"];

export function sendMessageToTab<T = unknown>(tabId: number, message: RuntimeMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

export async function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as T | Extract<RuntimeMessage, { type: "ERROR" }>;
  if (response && typeof response === "object" && (response as { type?: string }).type === "ERROR") {
    const { error, code } = response as Extract<RuntimeMessage, { type: "ERROR" }>;
    const err = new Error(error || "Background request failed.");
    if (code) err.name = code;
    throw err;
  }
  return response as T;
}
