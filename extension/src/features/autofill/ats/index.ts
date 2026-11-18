import type { AtsAdapter } from "./types";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { ashby } from "./ashby";
import { softgarden } from "./softgarden";
import { personio } from "./personio";
import { recruitee } from "./recruitee";
import { join } from "./join";

export type { AtsAdapter, UploadKind } from "./types";

/**
 * Every ATS adapter (`ats/<ats>.ts`), checked in order — the first whose `detect` says yes
 * handles the page; every hook it doesn't implement runs generically. Add one by dropping
 * `ats/<ats>.ts` next to these and appending it here.
 */
export const ATS_ADAPTERS: AtsAdapter[] = [greenhouse, lever, ashby, softgarden, personio, recruitee, join];

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

/** The adapter for the page `doc` shows (default: this frame's), or null on a non-ATS / unsupported page. */
export function activeAtsAdapter(doc: Document = document): AtsAdapter | null {
  if (typeof doc === "undefined") return null;
  return detectAts(urlOf(doc), doc);
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
