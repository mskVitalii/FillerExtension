import type { AtsAdapter, AtsStep } from "./types";
import { workdayAdapter } from "./workday";
import { successFactorsAdapter } from "./successfactors";

export type { AtsAdapter, AtsStep, AtsStepKind, CvHistory, EducationEntry, QuestionHints, WorkEntry } from "./types";
export { fillWorkdayExperience } from "./workday";

/**
 * Every ATS adapter, checked in order — the first whose `detect` says yes handles the
 * page. Add one by dropping `ats/<ats>.ts` next to these and appending it here.
 */
export const ATS_ADAPTERS: AtsAdapter[] = [workdayAdapter, successFactorsAdapter];

function currentUrl(): string {
  try {
    return location.href;
  } catch {
    return "";
  }
}

/** The adapter for `doc` (default: this frame's page), or null on a site no adapter knows. */
export function detectAts(url: string = currentUrl(), doc: Document = document): AtsAdapter | null {
  for (const adapter of ATS_ADAPTERS) {
    try {
      if (adapter.detect(url, doc)) return adapter;
    } catch {
      /* a broken detector never blocks the generic engine */
    }
  }
  return null;
}

/** Where this page sits in its ATS's multi-step flow, or null when no adapter knows the page or its steps. */
export function atsStep(doc: Document = document, url: string = currentUrl()): AtsStep | null {
  const adapter = detectAts(url, doc);
  return adapter?.step ? adapter.step(doc) : null;
}
