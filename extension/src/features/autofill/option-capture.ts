/**
 * The option texts the last dropdown pick attempt looked at. When an offline matcher finds no
 * option for a known value ("Germany" against "Bundesrepublik Deutschland"), the engine reads
 * them back here to ask the AI instead (`ai-assist.ts`) — a combobox's options only exist while
 * it is open, so they can't be re-read afterwards. The engine fills one field at a time, so one
 * slot is enough: it resets the slot before a field and reads it right after.
 */
let seen: string[] = [];

export function noteSeenOptions(texts: string[]): void {
  const clean = texts.filter(Boolean);
  if (clean.length > 0) seen = clean;
}

/** The last noted options, clearing the slot. */
export function takeSeenOptions(): string[] {
  const texts = seen;
  seen = [];
  return texts;
}
