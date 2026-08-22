import type { Job } from "./job";
import type { Profile, ProfileFieldKey } from "./profile";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";

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
  | { type: "EXPORT_PDF"; content: string; fileName: string };

export type RuntimeMessageType = RuntimeMessage["type"];

export function sendMessageToTab<T = unknown>(tabId: number, message: RuntimeMessage): Promise<T> {
  return chrome.tabs.sendMessage(tabId, message);
}

export function sendMessage<T = unknown>(message: RuntimeMessage): Promise<T> {
  return chrome.runtime.sendMessage(message);
}
