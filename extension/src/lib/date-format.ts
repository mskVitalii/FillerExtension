/**
 * `<input type="date">` (and its month/week/time/datetime-local siblings)
 * follows the same HTML value-sanitization algorithm as `type="number"`
 * (`@/lib` has no numeric equivalent of its own — that coercion lives next
 * to `fillElement` in `features/autofill/native-setter.ts` since it never
 * grew a second caller): a value that isn't in the exact required shape is
 * silently reset to `""` rather than rejected with an error. Confirmed live
 * on Stepstone — "Wann wäre Ihr frühestmögliches Startdatum?"
 * (`type="date"`) answered with "Mit einer Kündigungsfrist von einem
 * Monat." (a notice-period description, not a date) left the required
 * field empty with no visible cause.
 */

export type DateInputKind = "date" | "month" | "week" | "time" | "datetime-local";

const KIND_BY_TYPE: Record<string, DateInputKind> = {
  date: "date",
  month: "month",
  week: "week",
  time: "time",
  "datetime-local": "datetime-local",
};

/** Whether an `<input>`'s `type` attribute is one the browser hard-validates against an exact format string. */
export function dateInputKindForType(type: string): DateInputKind | null {
  return KIND_BY_TYPE[type] ?? null;
}

const EXACT_FORMAT: Record<DateInputKind, RegExp> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  week: /^\d{4}-W\d{2}$/,
  time: /^\d{2}:\d{2}(:\d{2})?$/,
  "datetime-local": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Coerces a free-text answer into the exact format an `<input>` of `kind`
 * requires. Already-correct input passes straight through; otherwise tries
 * the German `dd.mm.yyyy[ HH:mm]` shape explicitly (the model answers in
 * German on a German-language form despite being told the target format in
 * `answer-question.ts`'s DATE_RULE) before falling back to whatever
 * `Date.parse` can make of it. Returns null when nothing usable was found —
 * the caller must leave a required date field alone rather than write a
 * guess into it.
 */
export function coerceDateInputValue(kind: DateInputKind, raw: string): string | null {
  const trimmed = raw.trim();
  if (EXACT_FORMAT[kind].test(trimmed)) return trimmed;
  if (kind === "week") return null; // an ISO week number isn't worth guessing from prose

  const de = trimmed.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
  if (de) {
    const [, d, m, y, h, min] = de;
    const date = `${y}-${pad(Number(m))}-${pad(Number(d))}`;
    if (kind === "date") return date;
    if (kind === "month") return `${y}-${pad(Number(m))}`;
    if (kind === "datetime-local") return `${date}T${h ? pad(Number(h)) : "00"}:${min ?? "00"}`;
    if (kind === "time" && h) return `${pad(Number(h))}:${min}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = parsed.getMonth() + 1;
    const d = parsed.getDate();
    if (kind === "date") return `${y}-${pad(m)}-${pad(d)}`;
    if (kind === "month") return `${y}-${pad(m)}`;
    if (kind === "time") return `${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    if (kind === "datetime-local") {
      return `${y}-${pad(m)}-${pad(d)}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
    }
  }
  return null;
}

/** Human-readable example of `kind`'s exact required format, for the AI prompt. */
export const DATE_FORMAT_EXAMPLE: Record<DateInputKind, string> = {
  date: "2026-09-05",
  month: "2026-09",
  week: "2026-W36",
  time: "09:30",
  "datetime-local": "2026-09-05T09:30",
};

/** Today's date as `date` input wants it — the reference point the AI computes relative dates from. */
export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
