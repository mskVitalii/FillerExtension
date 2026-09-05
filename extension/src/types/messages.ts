import type { Job, JobLanguageInfo } from "./job";
import type { Profile } from "./profile";
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
  | { type: "GET_JOB"; tabId: number }
  | { type: "JOB_DATA"; job: Job; sufficient: boolean; visibleText?: string }
  | { type: "EXTRACT_JOB_FROM_TEXT"; tabId: number; text: string }
  | { type: "GET_PROFILE" }
  | { type: "PROFILE_DATA"; profile: Profile }
  | { type: "AUTOFILL"; tabId: number; profile: Profile }
  | { type: "AUTOFILL_RESULT"; filled: number; total: number; generatedPassword: string | null }
  | { type: "INSERT_VALUE"; field: InsertField; value: string }
  | { type: "GENERATE_COVER_LETTER"; job: Job }
  | { type: "COVER_LETTER_RESULT"; content: string; slopFindings: SlopFinding[]; cleaned: boolean }
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
      numeric?: boolean;
      dateKind?: DateInputKind;
    }
  | { type: "CUSTOM_QUESTION_ANSWER"; question: string; answer: string }
  | { type: "FILL_CUSTOM_QUESTION_ANSWERS"; tabId: number; answers: Record<string, string> }
  | { type: "CUSTOM_QUESTION_FILL_RESULT"; filled: number }
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
  | { type: "FILL_QUESTION_ANSWERS_BY_LOCATOR"; tabId: number; items: { locator: ElementLocator; answer: string }[] }
  | { type: "DETECT_CHECKBOXES"; tabId: number }
  | { type: "CHECKBOXES_DATA"; checkboxes: PageCheckbox[] }
  | { type: "DECIDE_CHECKBOXES"; checkboxes: PageCheckbox[] }
  | { type: "CHECKBOX_DECISIONS"; decisions: CheckboxDecision[] }
  | { type: "APPLY_CHECKBOX_DECISIONS"; tabId: number; decisions: CheckboxDecisionInput[] }
  | { type: "CHECKBOX_APPLY_RESULT"; changed: number }
  | { type: "DETECT_JOB_LANGUAGE"; job: Job }
  | { type: "JOB_LANGUAGE_DATA"; info: JobLanguageInfo }
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
