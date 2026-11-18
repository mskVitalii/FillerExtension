import type { Job } from "@/types/job";
import type { FillRun } from "@/features/fill-stats/stats";

/**
 * Experimental bridge to the local Filler agent (the separate FillerAgent
 * repo, next to this one): a Node process on 127.0.0.1 that applies to a
 * posting on its own Chrome. `sync.ts` keeps its copy of the user's data current.
 * The agent sends no CORS headers, so only an extension holding the
 * `http://127.0.0.1/*` host permission (requested from the optional ones on
 * the "Connect" click) can read its answers. Every call carries the agent's
 * token, which "Connect" fetches from `/api/pair` — the agent hands it only to
 * a request with a `chrome-extension://` Origin, so there is nothing to copy.
 */

export const AGENT_ORIGINS = ["http://127.0.0.1/*"];
export const DEFAULT_AGENT_PORT = 47615;
const STORAGE_KEY = "agentBridge";

export interface AgentBridgeSettings {
  port: number;
  token: string;
}

export type AgentHealth = "offline" | "unauthorized" | "online" | "no-permission";

export interface AgentCheck {
  eligible: boolean;
  reasons: string[];
  existingJob: { id: string; status: string; step: string } | null;
}

export async function getAgentSettings(): Promise<AgentBridgeSettings | null> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as AgentBridgeSettings | undefined;
  return stored?.token ? stored : null;
}

export async function saveAgentSettings(settings: AgentBridgeSettings | null): Promise<void> {
  if (settings) await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  else await chrome.storage.local.remove(STORAGE_KEY);
}

export function hasAgentPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: AGENT_ORIGINS });
}

/**
 * Must be the first thing a click handler calls — `permissions.request`
 * needs the user gesture, which an earlier `await` would use up.
 */
export function requestAgentPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: AGENT_ORIGINS });
}

/** Asks the running agent for its token. Throws "offline" when nothing answers on the port. */
export async function pairWithAgent(port = DEFAULT_AGENT_PORT): Promise<AgentBridgeSettings> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/pair`, { method: "POST", signal: AbortSignal.timeout(3000) });
  } catch {
    throw new Error("offline");
  }
  const data = (await res.json().catch(() => null)) as { token?: string; name?: string; error?: string } | null;
  if (!res.ok || !data?.token || data.name !== "filler-agent") throw new Error(data?.error ?? `Agent answered ${res.status}.`);
  const settings = { port, token: data.token };
  await saveAgentSettings(settings);
  return settings;
}

export function agentBaseUrl(settings: AgentBridgeSettings): string {
  return `http://127.0.0.1:${settings.port}`;
}

export function agentDashboardUrl(settings: AgentBridgeSettings): string {
  return `${agentBaseUrl(settings)}/`;
}

async function call<T>(settings: AgentBridgeSettings, path: string, body?: unknown, timeoutMs = 4000): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${agentBaseUrl(settings)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${settings.token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, data };
}

export async function agentHealth(settings: AgentBridgeSettings): Promise<AgentHealth> {
  if (!(await hasAgentPermission())) return "no-permission";
  try {
    const { status, data } = await call<{ name?: string }>(settings, "/api/health", undefined, 2500);
    if (status === 401 || status === 403) return "unauthorized";
    return status === 200 && data?.name === "filler-agent" ? "online" : "offline";
  } catch {
    return "offline";
  }
}

export async function checkWithAgent(settings: AgentBridgeSettings, url: string, job: Job): Promise<AgentCheck> {
  const { status, data } = await call<AgentCheck & { error?: string }>(settings, "/api/check", { url, job });
  if (status !== 200 || !data) throw new Error(data?.error ?? `Agent answered ${status}.`);
  return data;
}

export async function applyViaAgent(settings: AgentBridgeSettings, url: string, job: Job): Promise<{ id: string; status: string }> {
  const { status, data } = await call<{ id: string; status: string; error?: string; reasons?: string[] }>(settings, "/api/jobs", { url, job }, 8000);
  if (status !== 201 || !data) throw new Error(data?.reasons?.join(" ") || data?.error || `Agent answered ${status}.`);
  return data;
}

/** Fill statistics of every run the agent knows: its own and the ones this browser pushed. */
export async function fetchAgentFillRuns(settings: AgentBridgeSettings): Promise<FillRun[] | null> {
  try {
    const { status, data } = await call<{ runs?: FillRun[] }>(settings, "/api/stats", undefined, 4000);
    return status === 200 && Array.isArray(data?.runs) ? data.runs : null;
  } catch {
    return null;
  }
}

/** Sends this browser's autofill runs to the agent, which keeps them by id (a repeat costs nothing). */
export async function pushFillRuns(settings: AgentBridgeSettings, runs: FillRun[]): Promise<void> {
  if (runs.length === 0) return;
  await call(settings, "/api/stats/runs", { runs }, 8000);
}
