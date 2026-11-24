import { buildExport } from "@/features/export/data-export";
import { isGoogleConnected } from "@/features/google-drive/auth";
import { agentBaseUrl, projectHeaders, pushFillRuns, type AgentBridgeSettings } from "@/features/agent-bridge/client";
import { getJobSearchCredentials } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { getFillRuns } from "@/features/fill-stats/repository";
import { getFaqAnswers, saveFaqAnswers } from "@/features/profile/repository";
import type { FaqEntry } from "@/types/profile";
import { projectStorageKey } from "@/features/projects/scope";

/**
 * Keeps the local agent's copy of the user's data in step with the extension,
 * which stays the source of truth. The agent gets the same zip as Settings →
 * Export all data (`buildExport`, docs/export-format.md), so it has one
 * importer for both. Uploads happen only when the content changed:
 *
 * - a fingerprint of the local Drive caches says whether anything could have
 *   changed since the last sync, so an idle panel builds nothing;
 * - the export's `contentHash` is compared with the hash the agent stored, so
 *   an unchanged library is never re-sent;
 * - the applications list (one Drive read per application) goes along at most
 *   every few hours — the agent only uses it to skip postings already applied to.
 *
 * It also runs the other way: answers the user gave in the agent's dashboard
 * (FAQ entries with an `agent-…` id) are adopted into Filler's own FAQ first
 * (`mergeAgentFaq`, same-question dedupe), so the export that follows carries
 * them and the agent drops its own copies.
 */

const STATE_KEY = "agentBridgeSync";
const APPLICATIONS_EVERY_MS = 6 * 60 * 60 * 1000;

/** The cached Drive documents a sync carries (see `DRIVE_DOCS` in storage/drive-cache.ts). */
export const SYNCED_CACHE_KEYS = [
  "profileCache",
  "cvLibraryCache",
  "legendLibraryCache",
  "customFieldsCache",
  "languageLevelsCache",
  "faqAnswersCache",
  "cvTemplatesCache",
  "generationRulesCache",
  "outreachRulesCache",
] as const;

interface SyncState {
  fingerprint: string;
  hash: string;
  applicationsSyncedAt: number;
  syncedAt: number;
}

export interface AgentSyncResult {
  /** "uploaded" — sent now; "unchanged" — the agent already had it; "skipped" — not sent, see `message`. */
  outcome: "uploaded" | "unchanged" | "skipped";
  message?: string;
  syncedAt: number | null;
}

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The active project's copies of the synced caches (each project syncs into its own project in the agent). */
async function fingerprint(): Promise<string> {
  const keys = await Promise.all(SYNCED_CACHE_KEYS.map((key) => projectStorageKey(key)));
  const values = await chrome.storage.local.get(keys);
  return sha256(JSON.stringify(keys.map((key) => values[key] ?? null)));
}

async function readState(): Promise<SyncState | null> {
  const key = await projectStorageKey(STATE_KEY);
  return ((await chrome.storage.local.get(key))[key] as SyncState | undefined) ?? null;
}

export async function lastAgentSync(): Promise<number | null> {
  return (await readState())?.syncedAt ?? null;
}

async function agentSyncState(settings: AgentBridgeSettings): Promise<{ hash: string; agentFaq: FaqEntry[] }> {
  const res = await fetch(`${agentBaseUrl(settings)}/api/sync`, {
    headers: { Authorization: `Bearer ${settings.token}`, ...(await projectHeaders()) },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Agent answered ${res.status}.`);
  const data = (await res.json()) as { hash?: string; agentFaq?: FaqEntry[] };
  return { hash: data.hash ?? "", agentFaq: Array.isArray(data.agentFaq) ? data.agentFaq : [] };
}

function normalizeQuestion(text: string): string {
  return text
    .replace(/\((erforderlich|required|optional|pflichtfeld)\)/gi, "")
    .toLowerCase()
    .replace(/[*:?!.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The same question, worded with more or less around it ("Do you need visa sponsorship?" inside
 * "Do you need visa sponsorship? Please explain."). Mirrors the agent's `sameQuestion`.
 */
export function sameQuestion(a: string, b: string): boolean {
  const x = normalizeQuestion(a);
  const y = normalizeQuestion(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 15 && long.includes(short);
}

/**
 * Adopts answers given in the agent into Filler's FAQ: a question Filler already has gets the
 * answer only if its own is empty (Filler's answer wins otherwise); a new question is added once.
 * Returns null when nothing changes.
 */
export function mergeAgentFaq(local: FaqEntry[], fromAgent: FaqEntry[]): FaqEntry[] | null {
  const merged = local.map((entry) => ({ ...entry }));
  let changed = false;
  for (const answer of fromAgent) {
    if (!answer.question?.trim() || !answer.answer?.trim()) continue;
    const match = merged.find((entry) => sameQuestion(entry.question, answer.question));
    if (match) {
      if (!match.answer.trim()) {
        match.answer = answer.answer.trim();
        changed = true;
      }
      continue;
    }
    merged.push({ id: crypto.randomUUID(), question: answer.question.trim(), answer: answer.answer.trim() });
    changed = true;
  }
  return changed ? merged : null;
}

const SETTINGS_KEY = "agentBridgeSettingsHash";

/**
 * Settings the agent's own job search reuses: the search providers' keys and the "what I don't
 * want" text. Sent to the user's own agent on this machine (token-authenticated, loopback only),
 * and only when they changed.
 */
async function pushSearchSettings(settings: AgentBridgeSettings): Promise<void> {
  const [creds, prefs] = await Promise.all([getJobSearchCredentials(), getPreferences()]);
  const search = { ...creds, negative: prefs.jobSearchNegativePrompt ?? "" };
  const hash = await sha256(JSON.stringify(search));
  const settingsKey = await projectStorageKey(SETTINGS_KEY);
  const sent = (await chrome.storage.local.get(settingsKey))[settingsKey];
  if (sent === `${settings.port}:${hash}`) return;
  const res = await fetch(`${agentBaseUrl(settings)}/api/sync/settings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/json", ...(await projectHeaders()) },
    body: JSON.stringify({ search }),
    signal: AbortSignal.timeout(4000),
  });
  if (res.ok) await chrome.storage.local.set({ [settingsKey]: `${settings.port}:${hash}` });
}

const FILL_RUNS_KEY = "agentBridgeFillRunsSent";

/** This browser's autofill runs, for the agent's stats — sent again only when there are new ones. */
async function pushNewFillRuns(settings: AgentBridgeSettings): Promise<void> {
  const runs = await getFillRuns();
  if (runs.length === 0) return;
  const mark = `${settings.port}:${runs.length}:${runs[runs.length - 1].id}`;
  if ((await chrome.storage.local.get(FILL_RUNS_KEY))[FILL_RUNS_KEY] === mark) return;
  await pushFillRuns(settings, runs);
  await chrome.storage.local.set({ [FILL_RUNS_KEY]: mark });
}

let inFlight: Promise<AgentSyncResult> | null = null;

/**
 * Brings the agent up to date. `force` skips the local fingerprint shortcut
 * (used right before "Apply via AI agent"); the content hash still avoids a
 * pointless upload. Concurrent calls share one run.
 */
export function syncWithAgent(settings: AgentBridgeSettings, options: { force?: boolean } = {}): Promise<AgentSyncResult> {
  inFlight ??= runSync(settings, options.force ?? false).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(settings: AgentBridgeSettings, force: boolean): Promise<AgentSyncResult> {
  const [state, agent, google] = await Promise.all([readState(), agentSyncState(settings), isGoogleConnected()]);
  // Not tied to Drive: these live in this browser only.
  await Promise.all([pushSearchSettings(settings).catch(() => {}), pushNewFillRuns(settings).catch(() => {})]);
  const agentHash = agent.hash;
  // Drive is the source of truth; without it the local caches may be empty or stale, and an
  // empty export would wipe the agent's copy.
  if (!google) {
    return { outcome: "skipped", message: "Not synced — connect Google Drive in Filler first.", syncedAt: state?.syncedAt ?? null };
  }
  // Answers given in the agent come into Filler's FAQ first, so the upload below carries them.
  const adopted = agent.agentFaq.length > 0 ? mergeAgentFaq(await getFaqAnswers(), agent.agentFaq) : null;
  if (adopted) await saveFaqAnswers(adopted);
  const print = await fingerprint();
  const now = Date.now();
  const applicationsDue = !state || now - state.applicationsSyncedAt > APPLICATIONS_EVERY_MS;
  if (!force && !adopted && !applicationsDue && state && agentHash && state.fingerprint === print && state.hash === agentHash) {
    return { outcome: "unchanged", syncedAt: state.syncedAt };
  }

  const result = await buildExport(new Date(), { applications: applicationsDue ? "records" : "none" });
  // Without Google Drive the export has CV texts but no files — sending it would strip the
  // agent of CVs it can attach. Keep the agent's copy until Drive works again.
  const missingCvFiles = result.manifest.warnings.filter((w) => w.startsWith("CV ") || w.startsWith("CVs:"));
  if (missingCvFiles.length > 0) {
    return { outcome: "skipped", message: `Not synced — couldn't read your CV files (${missingCvFiles[0]}). Is Google Drive connected?`, syncedAt: state?.syncedAt ?? null };
  }

  const stateKey = await projectStorageKey(STATE_KEY);
  const save = (hash: string, applicationsSyncedAt: number) =>
    chrome.storage.local.set({ [stateKey]: { fingerprint: print, hash, applicationsSyncedAt, syncedAt: now } satisfies SyncState });

  if (!applicationsDue && result.contentHash === agentHash) {
    await save(agentHash, state?.applicationsSyncedAt ?? 0);
    return { outcome: "unchanged", syncedAt: now };
  }

  const res = await fetch(`${agentBaseUrl(settings)}/api/sync?hash=${result.contentHash}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/zip", ...(await projectHeaders()) },
    body: new Blob([result.zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const error = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(error ?? `Agent answered ${res.status}.`);
  }
  await save(result.contentHash, applicationsDue ? now : (state?.applicationsSyncedAt ?? 0));
  return { outcome: "uploaded", syncedAt: now };
}
