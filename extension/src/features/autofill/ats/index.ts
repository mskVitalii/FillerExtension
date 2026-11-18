import type { AtsAdapter } from "./types";
import { dvinci } from "./dvinci";
import { rexx } from "./rexx";
import { umantis } from "./umantis";
import { concludis } from "./concludis";
import { smartrecruiters } from "./smartrecruiters";

export type { AtsAdapter, FileSlot } from "./types";

/**
 * ATS-specific adapters (`ats/<ats>.ts`), tried in order; the first whose `detect` matches the
 * current page is the active one. Everything not covered by an adapter hook runs generically.
 */
export const ATS_ADAPTERS: AtsAdapter[] = [dvinci, rexx, umantis, concludis, smartrecruiters];

export function detectAts(url: string, doc: Document): AtsAdapter | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return ATS_ADAPTERS.find((adapter) => adapter.detect(parsed, doc)) ?? null;
}

/** The adapter for the page this script runs in, if any. */
export function activeAtsAdapter(): AtsAdapter | null {
  if (typeof location === "undefined" || typeof document === "undefined") return null;
  return detectAts(location.href, document);
}

/** Where the application form is when the current page is a step before it (see `AtsAdapter.formEntry`). */
export function atsFormEntry(): { ats: string; url?: string; click?: HTMLElement } | null {
  const adapter = activeAtsAdapter();
  const entry = adapter?.formEntry?.(new URL(location.href), document) ?? null;
  return adapter && entry ? { ats: adapter.id, ...entry } : null;
}
