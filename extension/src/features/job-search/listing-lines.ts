import type { JobSearchResult } from "@/types/job-search";

export type Listing = Omit<JobSearchResult, "source" | "tag">;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * One line of the web search's JSON Lines answer, or null when the line
 * isn't a posting object (prose, a code fence, a malformed or URL-less
 * object). Tolerates a list marker or trailing comma around the object.
 */
export function parseListingLine(line: string): Listing | null {
  const trimmed = line
    .trim()
    .replace(/^(?:[-*•]|\d+[.)])\s+/u, "")
    .replace(/,$/, "");
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  const url = text(raw.url);
  const title = text(raw.title);
  if (!/^https?:\/\//i.test(url) || !title) return null;
  return {
    title,
    company: text(raw.company),
    location: text(raw.location),
    url,
    salary: text(raw.salary),
    snippet: text(raw.snippet),
    postedAt: text(raw.postedAt),
  };
}

/**
 * Feeds streamed text in, calls `onListing` for each complete line that
 * parses as a posting — as soon as its newline arrives. `end()` flushes
 * the last line, which may come without a trailing newline.
 */
export function createListingLineParser(onListing: (listing: Listing) => void): { push(delta: string): void; end(): void } {
  let buffer = "";
  function flush(line: string) {
    const listing = parseListingLine(line);
    if (listing) onListing(listing);
  }
  return {
    push(delta) {
      buffer += delta;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        flush(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    },
    end() {
      flush(buffer);
      buffer = "";
    },
  };
}
