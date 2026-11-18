import type { AtsAdapter, AtsStep } from "./types";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { ashby } from "./ashby";
import { softgarden } from "./softgarden";
import { personio } from "./personio";
import { recruitee } from "./recruitee";
import { join } from "./join";
import { workday } from "./workday";
import { successfactors } from "./successfactors";
import { smartrecruiters } from "./smartrecruiters";
import { dvinci } from "./dvinci";
import { rexx } from "./rexx";
import { umantis } from "./umantis";
import { concludis } from "./concludis";

export type {
  AtsAdapter,
  AtsStep,
  AtsStepKind,
  CvHistory,
  EducationEntry,
  FileSlot,
  QuestionHints,
  UploadKind,
  WorkEntry,
} from "./types";
export { fillWorkdayExperience } from "./workday";

/**
 * Every ATS adapter (`ats/<ats>.ts`), checked in order — the first whose `detect` says yes
 * handles the page; every hook it doesn't implement runs generically. Add one by dropping
 * `ats/<ats>.ts` next to these and appending it here.
 */
export const ATS_ADAPTERS: AtsAdapter[] = [
  greenhouse,
  lever,
  ashby,
  softgarden,
  personio,
  recruitee,
  join,
  workday,
  successfactors,
  smartrecruiters,
  dvinci,
  rexx,
  umantis,
  concludis,
];

function urlOf(doc: Document): string {
  try {
    return doc.location?.href ?? "";
  } catch {
    return "";
  }
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    // An unparseable URL still leaves the DOM markers to recognise the ATS by.
    return new URL("about:blank");
  }
}

/** The adapter for `doc` at `url` (default: this frame's page), or null on a site no adapter knows. */
export function detectAts(url: string = urlOf(document), doc: Document = document): AtsAdapter | null {
  const parsed = parseUrl(url);
  for (const adapter of ATS_ADAPTERS) {
    try {
      if (adapter.detect(parsed, doc)) return adapter;
    } catch {
      /* a broken detector never blocks the generic engine */
    }
  }
  return null;
}

/**
 * Per-run memo of `activeAtsAdapter`. Every field asks "which ATS is this page?" — through
 * `detectSemanticField`, the question scan, checkbox and upload targeting — and each answer
 * runs all adapters' `detect` (several DOM queries apiece), so a long form paid that once per
 * field. Inside `withAtsCache` the answer is computed once per document and URL; outside it
 * (tests, the refill guard firing later) detection stays live, so a form that renders after
 * the run, or a fixture swapped into the same `document`, is never answered from a stale entry.
 */
let cacheDepth = 0;
let detected = new WeakMap<Document, { url: string; adapter: AtsAdapter | null }>();

/** Runs `run` (sync or async) with ATS detection memoised until it settles. Nests safely. */
export function withAtsCache<T>(run: () => T): T {
  cacheDepth++;
  const leave = () => {
    cacheDepth--;
    if (cacheDepth === 0) detected = new WeakMap();
  };
  let result: T;
  try {
    result = run();
  } catch (error) {
    leave();
    throw error;
  }
  if (result instanceof Promise) return result.finally(leave) as T;
  leave();
  return result;
}

/** The adapter for the page `doc` shows (default: this frame's), or null on a non-ATS / unsupported page. */
export function activeAtsAdapter(doc: Document = document): AtsAdapter | null {
  if (typeof doc === "undefined") return null;
  const url = urlOf(doc);
  if (cacheDepth === 0) return detectAts(url, doc);
  const hit = detected.get(doc);
  // Same document, new URL: an SPA moved to its next step mid-run — detect again.
  if (hit && hit.url === url) return hit.adapter;
  const adapter = detectAts(url, doc);
  detected.set(doc, { url, adapter });
  return adapter;
}

/** `activeAtsAdapter` for the document `el` lives in. */
export function atsAdapterFor(el: Element): AtsAdapter | null {
  return activeAtsAdapter(el.ownerDocument);
}

/** True when the page's adapter says automatic passes must skip `el`. */
export function isAtsIgnored(el: HTMLElement): boolean {
  return atsAdapterFor(el)?.isIgnored?.(el) ?? false;
}

/** The page adapter's own label for `el`, or "". */
export function atsFieldLabel(el: HTMLElement): string {
  return atsAdapterFor(el)?.fieldLabel?.(el)?.replace(/\s+/g, " ").trim() ?? "";
}

/** Where this page sits in its ATS's multi-step flow, or null when no adapter knows the page or its steps. */
export function atsStep(doc: Document = document, url: string = urlOf(doc)): AtsStep | null {
  const adapter = detectAts(url, doc);
  return adapter?.step ? adapter.step(doc) : null;
}

/** Where the application form is when the current page is a step before it (see `AtsAdapter.formEntry`). */
export function atsFormEntry(doc: Document = document): { ats: string; url?: string; click?: HTMLElement } | null {
  const adapter = activeAtsAdapter(doc);
  const entry = adapter?.formEntry?.(parseUrl(urlOf(doc)), doc) ?? null;
  return adapter && entry ? { ats: adapter.id, ...entry } : null;
}
