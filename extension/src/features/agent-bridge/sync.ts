import { buildExport } from "@/features/export/data-export";
import { isGoogleConnected } from "@/features/google-drive/auth";
import { agentBaseUrl, type AgentBridgeSettings } from "@/features/agent-bridge/client";

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

async function fingerprint(): Promise<string> {
  const values = await chrome.storage.local.get([...SYNCED_CACHE_KEYS]);
  return sha256(JSON.stringify(SYNCED_CACHE_KEYS.map((key) => values[key] ?? null)));
}

async function readState(): Promise<SyncState | null> {
  return ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as SyncState | undefined) ?? null;
}

export async function lastAgentSync(): Promise<number | null> {
  return (await readState())?.syncedAt ?? null;
}

async function agentSyncHash(settings: AgentBridgeSettings): Promise<string> {
  const res = await fetch(`${agentBaseUrl(settings)}/api/sync`, {
    headers: { Authorization: `Bearer ${settings.token}` },
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`Agent answered ${res.status}.`);
  return ((await res.json()) as { hash?: string }).hash ?? "";
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
  const [state, print, agentHash, google] = await Promise.all([readState(), fingerprint(), agentSyncHash(settings), isGoogleConnected()]);
  // Drive is the source of truth; without it the local caches may be empty or stale, and an
  // empty export would wipe the agent's copy.
  if (!google) {
    return { outcome: "skipped", message: "Not synced — connect Google Drive in Filler first.", syncedAt: state?.syncedAt ?? null };
  }
  const now = Date.now();
  const applicationsDue = !state || now - state.applicationsSyncedAt > APPLICATIONS_EVERY_MS;
  if (!force && !applicationsDue && state && agentHash && state.fingerprint === print && state.hash === agentHash) {
    return { outcome: "unchanged", syncedAt: state.syncedAt };
  }

  const result = await buildExport(new Date(), { applications: applicationsDue ? "records" : "none" });
  // Without Google Drive the export has CV texts but no files — sending it would strip the
  // agent of CVs it can attach. Keep the agent's copy until Drive works again.
  const missingCvFiles = result.manifest.warnings.filter((w) => w.startsWith("CV ") || w.startsWith("CVs:"));
  if (missingCvFiles.length > 0) {
    return { outcome: "skipped", message: `Not synced — couldn't read your CV files (${missingCvFiles[0]}). Is Google Drive connected?`, syncedAt: state?.syncedAt ?? null };
  }

  const save = (hash: string, applicationsSyncedAt: number) =>
    chrome.storage.local.set({ [STATE_KEY]: { fingerprint: print, hash, applicationsSyncedAt, syncedAt: now } satisfies SyncState });

  if (!applicationsDue && result.contentHash === agentHash) {
    await save(agentHash, state?.applicationsSyncedAt ?? 0);
    return { outcome: "unchanged", syncedAt: now };
  }

  const res = await fetch(`${agentBaseUrl(settings)}/api/sync?hash=${result.contentHash}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.token}`, "Content-Type": "application/zip" },
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
