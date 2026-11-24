import * as drive from "@/features/google-drive/client";
import { isGoogleConnected } from "@/features/google-drive/auth";
import {
  DEFAULT_PROJECT_ID,
  liveProjects,
  mergeProjects,
  newProjectId,
  normalizeProjects,
  resolveProjectId,
  sameProjects,
  type Project,
} from "./registry";
import { ACTIVE_PROJECT_KEY } from "./scope";

/**
 * This browser's projects: the registry cached in `chrome.storage.local.projects`, kept in step
 * with Drive `projects.json` (merged by id, see `mergeProjects`), and the active project. The
 * active one is per browser and never synced.
 */

const REGISTRY_KEY = "projects";
const REGISTRY_FILE = "projects.json";

async function readLocalRegistry(): Promise<Project[]> {
  const stored = (await chrome.storage.local.get(REGISTRY_KEY))?.[REGISTRY_KEY] as { items?: unknown } | undefined;
  return normalizeProjects(stored?.items);
}

async function writeLocalRegistry(items: Project[]): Promise<void> {
  await chrome.storage.local.set({ [REGISTRY_KEY]: { items } });
}

/** Every project of this browser that isn't deleted, Default first. */
export async function listProjects(): Promise<Project[]> {
  return liveProjects(await readLocalRegistry());
}

export async function getActiveProjectId(): Promise<string> {
  const [items, stored] = await Promise.all([readLocalRegistry(), chrome.storage.local.get(ACTIVE_PROJECT_KEY)]);
  return resolveProjectId(items, stored?.[ACTIVE_PROJECT_KEY]);
}

export async function setActiveProject(id: string): Promise<void> {
  const items = await readLocalRegistry();
  const next = resolveProjectId(items, id);
  if (next === DEFAULT_PROJECT_ID) await chrome.storage.local.remove(ACTIVE_PROJECT_KEY);
  else await chrome.storage.local.set({ [ACTIVE_PROJECT_KEY]: next });
}

/** Writes the registry here and (best effort) to Drive, merged with Drive's copy. */
async function saveRegistry(items: Project[]): Promise<void> {
  await writeLocalRegistry(items);
  await pushRegistry().catch(() => undefined);
}

async function pushRegistry(): Promise<Project[]> {
  const local = await readLocalRegistry();
  if (!(await isGoogleConnected())) return local;
  const remote = await drive.readJsonFile<{ items?: unknown }>(REGISTRY_FILE);
  const merged = mergeProjects(local, remote?.items);
  if (!remote || !sameProjects(merged, normalizeProjects(remote.items))) await drive.writeJsonFile(REGISTRY_FILE, { items: merged });
  if (!sameProjects(merged, local)) await writeLocalRegistry(merged);
  return merged;
}

/**
 * Brings the registry in step with Drive (panel open, after "Connect Google"): projects made in
 * another browser or in the agent show up, deleted ones go. True when the list or the active
 * project changed. A no-op without Google.
 */
export async function refreshProjects(): Promise<boolean> {
  const before = await readLocalRegistry();
  const activeBefore = await getActiveProjectId();
  let merged: Project[];
  try {
    merged = await pushRegistry();
  } catch {
    return false;
  }
  const activeAfter = resolveProjectId(merged, activeBefore);
  if (activeAfter !== activeBefore) await setActiveProject(activeAfter);
  return !sameProjects(before, merged) || activeAfter !== activeBefore;
}

export async function createProject(name: string): Promise<Project> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("A project needs a name.");
  const now = new Date().toISOString();
  const project: Project = { id: newProjectId(), name: clean, createdAt: now, updatedAt: now };
  await saveRegistry(normalizeProjects([...(await readLocalRegistry()), project]));
  return project;
}

export async function renameProject(id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new Error("A project needs a name.");
  const items = await readLocalRegistry();
  if (!items.some((p) => p.id === id && !p.deletedAt)) throw new Error("No such project.");
  const now = new Date().toISOString();
  await saveRegistry(items.map((p) => (p.id === id ? { ...p, name: clean, updatedAt: now } : p)));
}

/**
 * Deletes a project: a tombstone in the registry (Drive tells the other browsers and the agent).
 * Its caches here and its Drive files stay — nothing is erased. Default can't be deleted; the
 * active project falls back to Default when it was this one.
 */
export async function deleteProject(id: string): Promise<void> {
  if (id === DEFAULT_PROJECT_ID) throw new Error("The Default project can't be deleted.");
  const items = await readLocalRegistry();
  if (!items.some((p) => p.id === id && !p.deletedAt)) throw new Error("No such project.");
  const now = new Date().toISOString();
  const active = await getActiveProjectId();
  await saveRegistry(items.map((p) => (p.id === id ? { ...p, deletedAt: now, updatedAt: now } : p)));
  if (active === id) await setActiveProject(DEFAULT_PROJECT_ID);
}
