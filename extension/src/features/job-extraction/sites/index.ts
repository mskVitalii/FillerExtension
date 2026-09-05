import type { Job } from "@/types/job";
import { extractWorkAtAStartup } from "./workatastartup";

/**
 * Site-specific extractors, tried in order. Each recognises its own page
 * (by hostname / meta signals) and returns only the fields it can fill with
 * confidence — the generic DOM/JSON-LD pass fills the rest (see
 * `extractor.ts#extractJob`). Add a new site by dropping a module here and
 * appending it to `SITE_EXTRACTORS`.
 */
type SiteExtractor = (doc: Document, url: string) => Partial<Job> | null;

const SITE_EXTRACTORS: SiteExtractor[] = [extractWorkAtAStartup];

/** First matching site extractor's fields, or `null` when none recognise the page. */
export function extractSiteSpecific(doc: Document, url: string): Partial<Job> | null {
  for (const extract of SITE_EXTRACTORS) {
    try {
      const result = extract(doc, url);
      if (result && Object.keys(result).length > 0) return result;
    } catch {
      // A site extractor must never break generic extraction — skip it and move on.
    }
  }
  return null;
}
