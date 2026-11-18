import type { ProfileFieldKey } from "@/types/profile";
import type { FileKind } from "@/features/file-upload/inject-file";
import { softgarden } from "./softgarden";
import { personio } from "./personio";
import { recruitee } from "./recruitee";
import { join } from "./join";

/**
 * Per-ATS knowledge the generic engine can't infer from labels alone. Every hook is optional:
 * an adapter states only what its ATS does differently, and the generic pass handles the rest.
 * Keep adapters small and markup-driven (stable `name`s, test ids), never tied to generated
 * CSS class hashes.
 */
export interface AtsAdapter {
  id: string;
  /** True on this ATS's application form: by host, or by markup when it's served from the employer's own domain. */
  detect(url: string, doc: Document): boolean;
  /**
   * The profile field `el` holds, when the ATS's own naming says so and the label doesn't
   * (Personio's `location` is the applicant's city). `undefined` = no opinion, let the
   * generic detector decide; `null` = definitely not a profile field.
   */
  profileField?(el: HTMLElement): ProfileFieldKey | null | undefined;
  /** Where a document goes when no upload slot is labelled for it (softgarden's "further attachments"). */
  fallbackFileInput?(kind: FileKind, doc: Document): HTMLInputElement | null;
  /**
   * Multi-step forms: the button that reveals or moves to the next step, when one is showing.
   * Never the final submit. For a driver (the local agent) to advance the form; the content
   * script itself never clicks it.
   */
  nextStepButton?(doc: Document): HTMLElement | null;
  /** The button that sends the application — for a driver to stop before and hand to the user. */
  submitButton?(doc: Document): HTMLElement | null;
}

const ADAPTERS: AtsAdapter[] = [softgarden, personio, recruitee, join];

/** The adapter for the page at `url`, if any. */
export function detectAts(url: string, doc: Document): AtsAdapter | null {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.detect(url, doc)) return adapter;
    } catch {
      /* a detector must never break the generic pass */
    }
  }
  return null;
}

/** The adapter for the current frame. */
export function currentAts(): AtsAdapter | null {
  if (typeof document === "undefined") return null;
  return detectAts(document.location?.href ?? "", document);
}
