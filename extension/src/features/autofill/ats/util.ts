/** Lower-cased host of `url`, or "" when it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Whitespace-collapsed text of `el`, or "". */
export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Drops a trailing required marker ("*", Lever's "✱"). */
export function withoutRequiredMarker(text: string): string {
  return text.replace(/[\s*✱]+$/, "").trim();
}
