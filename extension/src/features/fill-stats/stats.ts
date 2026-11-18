/**
 * Autofill quality, measured where it happens: every "Autofill" click in the
 * browser (`source: "extension"`, recorded by the content script once the
 * refill guard settles) and every run of the local agent (`source: "agent"`,
 * derived from its job records). Both sides keep the same `FillRun` shape and
 * summarize with the same `summarizeFillRuns`, so the Side Panel and the
 * agent's dashboard show the same numbers — the agent holds the merged list
 * (`GET /api/stats`), the extension its own runs and pushes them over.
 *
 * Pure: no DOM, no chrome.* — the agent imports it under Node.
 */

export type FillSource = "extension" | "agent";

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "combobox"
  | "contenteditable"
  | "file"
  | "checkbox"
  | "radio"
  | "other";

/**
 * What Filler's own autofill did with a field:
 * - `filled` — wrote the profile value and it stayed;
 * - `lost` — wrote it, but the page reset or replaced it and the guard couldn't keep it;
 * - `failed` — recognized the field and had a value, but the write didn't take;
 * - `no-value` — recognized the field, but the profile has nothing for it;
 * - `missed` — the agent later filled it from the profile, so Filler should have (agent runs only);
 * - `other` — not a profile field (custom question, consent, upload, …): outside autofill.
 */
export type FillerOutcome = "filled" | "lost" | "failed" | "no-value" | "missed" | "other";

/** Agent runs only: the field's state at the end (its self-check). */
export type FinalOutcome = "ok" | "wrong" | "empty";

export interface FillFieldStat {
  kind: FieldKind;
  /** The profile field it was recognized as (`email`, `phone`, …) or the agent's value source; null when none. */
  field: string | null;
  label: string;
  filler: FillerOutcome;
  final?: FinalOutcome;
}

export interface FillRun {
  /** Stable, so a run pushed twice is stored once. */
  id: string;
  at: string;
  source: FillSource;
  host: string;
  /** The applicant tracking system behind the form, when recognizable (`greenhouse`, `workday`, …). */
  ats: string | null;
  fields: FillFieldStat[];
}

const ATS_HOSTS: [RegExp, string][] = [
  [/greenhouse\.io$/, "greenhouse"],
  [/lever\.co$/, "lever"],
  [/ashbyhq\.com$/, "ashby"],
  [/myworkdayjobs\.com$|workday\.com$/, "workday"],
  [/workable\.com$/, "workable"],
  [/smartrecruiters\.com$/, "smartrecruiters"],
  [/personio\.(de|com)$/, "personio"],
  [/recruitee\.com$/, "recruitee"],
  [/bamboohr\.com$/, "bamboohr"],
  [/teamtailor\.com$/, "teamtailor"],
  [/join\.com$/, "join"],
  [/jobvite\.com$/, "jobvite"],
  [/icims\.com$/, "icims"],
  [/successfactors\.(com|eu)$/, "successfactors"],
  [/taleo\.net$/, "taleo"],
  [/breezy\.hr$/, "breezy"],
  [/softgarden\.(io|de)$/, "softgarden"],
  [/rippling\.com$/, "rippling"],
  [/dvinci(-hr|-easy)?\.(com|de)$/, "dvinci"],
  [/rexx-(recruitment|systems)\.com$/, "rexx"],
  [/umantis\.com$/, "umantis"],
  [/concludis\.de$/, "concludis"],
];

/**
 * The ATS behind a form. Many employers embed one on their own careers page
 * (Greenhouse's `?gh_jid=`, Lever's `lever-` ids), so the page URL and any
 * frame URLs the caller knows of are all checked.
 */
export function atsOf(...urls: (string | undefined)[]): string | null {
  for (const raw of urls) {
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    for (const [pattern, name] of ATS_HOSTS) if (pattern.test(host)) return name;
    if (url.searchParams.has("gh_jid")) return "greenhouse";
    if (url.searchParams.has("lever-source") || url.searchParams.has("lever-origin")) return "lever";
    if (url.searchParams.has("ashby_jid")) return "ashby";
  }
  return null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Outcomes where Filler should have filled the field and didn't. */
export const FILLER_MISSES: readonly FillerOutcome[] = ["lost", "failed", "missed"];
/** Outcomes that count toward Filler's fill rate: profile fields it could act on. */
const FILLER_RELEVANT: readonly FillerOutcome[] = ["filled", "lost", "failed", "missed"];

export interface FillRate {
  /** Fields that count (denominator). */
  total: number;
  /** Fields that worked (numerator). */
  ok: number;
}

export interface FillDay {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Filler's own autofill in the browser. */
  extension: FillRate;
  /** Filler's autofill inside agent runs (same engine, the agent's Chrome). */
  fillerInAgent: FillRate;
  /** Every field of agent runs, at the end of the run (Filler + the agent's model). */
  agentFinal: FillRate;
}

export interface FillMiss {
  kind: FieldKind;
  ats: string | null;
  outcome: FillerOutcome;
  count: number;
  /** Up to three labels, for recognizing the widget. */
  examples: string[];
  sources: FillSource[];
}

export interface FillStatsSummary {
  runs: { extension: number; agent: number };
  totals: { extension: FillRate; fillerInAgent: FillRate; agentFinal: FillRate };
  days: FillDay[];
  /** Filler's misses grouped by widget kind × ATS × outcome, most frequent first. */
  misses: FillMiss[];
  /** Agent runs: fields still wrong or empty at the end, grouped the same way. */
  unresolved: FillMiss[];
}

const rate = (): FillRate => ({ total: 0, ok: 0 });

function localDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addFiller(target: FillRate, f: FillFieldStat): void {
  if (!FILLER_RELEVANT.includes(f.filler)) return;
  target.total++;
  if (f.filler === "filled") target.ok++;
}

export function percent(r: FillRate): number | null {
  return r.total === 0 ? null : Math.round((r.ok / r.total) * 100);
}

function group(list: { f: FillFieldStat; run: FillRun; outcome: FillerOutcome }[]): FillMiss[] {
  const map = new Map<string, FillMiss>();
  for (const { f, run, outcome } of list) {
    const key = `${f.kind}|${run.ats ?? ""}|${outcome}`;
    let m = map.get(key);
    if (!m) {
      m = { kind: f.kind, ats: run.ats, outcome, count: 0, examples: [], sources: [] };
      map.set(key, m);
    }
    m.count++;
    const label = f.label.trim().slice(0, 80);
    if (label && m.examples.length < 3 && !m.examples.includes(label)) m.examples.push(label);
    if (!m.sources.includes(run.source)) m.sources.push(run.source);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Days with no runs are left out; `days` is sorted oldest first. */
export function summarizeFillRuns(runs: FillRun[]): FillStatsSummary {
  const days = new Map<string, FillDay>();
  const totals = { extension: rate(), fillerInAgent: rate(), agentFinal: rate() };
  const misses: { f: FillFieldStat; run: FillRun; outcome: FillerOutcome }[] = [];
  const unresolved: { f: FillFieldStat; run: FillRun; outcome: FillerOutcome }[] = [];
  const counts = { extension: 0, agent: 0 };

  for (const run of runs) {
    counts[run.source]++;
    const date = localDate(run.at);
    let day = days.get(date);
    if (!day) {
      day = { date, extension: rate(), fillerInAgent: rate(), agentFinal: rate() };
      days.set(date, day);
    }
    for (const f of run.fields) {
      if (run.source === "extension") {
        addFiller(day.extension, f);
        addFiller(totals.extension, f);
      } else {
        addFiller(day.fillerInAgent, f);
        addFiller(totals.fillerInAgent, f);
        if (f.final) {
          day.agentFinal.total++;
          totals.agentFinal.total++;
          if (f.final === "ok") {
            day.agentFinal.ok++;
            totals.agentFinal.ok++;
          } else unresolved.push({ f, run, outcome: f.filler });
        }
      }
      if (FILLER_MISSES.includes(f.filler)) misses.push({ f, run, outcome: f.filler });
    }
  }

  return {
    runs: counts,
    totals,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    misses: group(misses),
    unresolved: group(unresolved),
  };
}

/** Keeps the newest `max` runs, one per id. */
export function mergeFillRuns(existing: FillRun[], incoming: FillRun[], max = 500): FillRun[] {
  const byId = new Map<string, FillRun>();
  for (const run of [...existing, ...incoming]) if (run?.id && Array.isArray(run.fields)) byId.set(run.id, run);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-max);
}
