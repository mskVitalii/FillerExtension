import type { Job, JobLanguageInfo } from "./job";
import type { Profile, ProfileFieldKey } from "./profile";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";
import type { CustomQuestion } from "@/features/autofill/custom-questions";

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
  | { type: "AUTOFILL_RESULT"; filled: number; total: number }
  | { type: "INSERT_VALUE"; field: ProfileFieldKey | "cv" | "coverLetter"; value: string }
  | { type: "GENERATE_COVER_LETTER"; job: Job }
  | { type: "COVER_LETTER_RESULT"; content: string; slopFindings: SlopFinding[]; cleaned: boolean }
  | {
      type: "UPLOAD_FILE";
      tabId: number;
      kind: "cv" | "coverLetter";
      fileName: string;
      mimeType: string;
      base64Data: string;
    }
  | { type: "UPLOAD_FILE_RESULT"; nativeInputs: number; dropZones: number }
  | { type: "EXPORT_PDF"; content: string; fileName: string }
  | { type: "REVISE_COVER_LETTER"; job: Job; content: string; instructions: string }
  | { type: "REVISE_COVER_LETTER_RESULT"; content: string }
  | { type: "TRANSLATE_COVER_LETTER"; content: string; targetLanguage: string }
  | { type: "TRANSLATE_COVER_LETTER_RESULT"; content: string }
  | { type: "DETECT_CUSTOM_QUESTIONS"; tabId: number }
  | { type: "CUSTOM_QUESTIONS_DATA"; questions: CustomQuestion[] }
  | { type: "ANSWER_CUSTOM_QUESTION"; question: string; job: Job }
  | { type: "CUSTOM_QUESTION_ANSWER"; question: string; answer: string }
  | { type: "DETECT_JOB_LANGUAGE"; job: Job }
  | { type: "JOB_LANGUAGE_DATA"; info: JobLanguageInfo };

export type RuntimeMessageType = RuntimeMessage["type"];

export function sendMessageToTab<T = unknown>(tabId: number, message: RuntimeMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

export function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
