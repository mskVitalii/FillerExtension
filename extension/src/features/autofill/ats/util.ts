/** Lower-cased hostname of `url`, or "" when it doesn't parse. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** First visible-ish button whose text matches `re`. */
export function buttonByText(doc: Document, re: RegExp, scope = "button, [role='button']"): HTMLElement | null {
  for (const el of doc.querySelectorAll<HTMLElement>(scope)) {
    if ((el as HTMLButtonElement).disabled) continue;
    if (re.test((el.textContent ?? "").replace(/\s+/g, " ").trim())) return el;
  }
  return null;
}
