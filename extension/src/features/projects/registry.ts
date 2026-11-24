/**
 * Projects: one set of everything the first-run setup collects (profile, CVs, Personal Legend,
 * FAQ, rules, search), so one person can apply for very different kinds of jobs. Pure rules shared
 * by the extension and the agent (FillerAgent imports this through `@/`); see FillerAgent
 * `docs/projects.md`.
 *
 * The Default project is the layout from before projects: its Drive files, storage keys and the
 * agent's folders keep their old names. Every other project lives under a prefix — so nothing is
 * migrated, and a client that doesn't know projects yet keeps working on Default.
 */

export const DEFAULT_PROJECT_ID = "default";
export const DEFAULT_PROJECT_NAME = "Default";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** A tombstone: the project was deleted (it stays in the list so other devices drop it too). */
  deletedAt?: string;
}

/** `projects.json` in Drive (and the local caches of it). */
export interface ProjectRegistry {
  items: Project[];
}

const EPOCH = "1970-01-01T00:00:00.000Z";

export function defaultProject(now = EPOCH): Project {
  return { id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME, createdAt: now, updatedAt: EPOCH };
}

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}

/** A short random id: `p-` + 10 base-36 characters. */
export function newProjectId(random: () => number = Math.random): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += Math.floor(random() * 36).toString(36);
  return `p-${id}`;
}

function valid(p: unknown): p is Project {
  const x = p as Project;
  return Boolean(x) && isProjectId(x.id) && typeof x.name === "string" && typeof x.updatedAt === "string";
}

/** The list with Default always present (never deleted) and malformed entries dropped. */
export function normalizeProjects(items: unknown): Project[] {
  const list = Array.isArray(items) ? items.filter(valid) : [];
  const byId = new Map<string, Project>();
  for (const p of list) {
    const prev = byId.get(p.id);
    if (!prev || newer(p, prev)) byId.set(p.id, { ...p, createdAt: p.createdAt || p.updatedAt });
  }
  const def = byId.get(DEFAULT_PROJECT_ID);
  byId.set(DEFAULT_PROJECT_ID, def ? { ...def, deletedAt: undefined, name: def.name.trim() || DEFAULT_PROJECT_NAME } : defaultProject());
  const out = [...byId.values()].map((p) => (p.deletedAt === undefined ? stripDeleted(p) : p));
  // Default first, then by creation.
  return out.sort((a, b) => (a.id === DEFAULT_PROJECT_ID ? -1 : b.id === DEFAULT_PROJECT_ID ? 1 : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)));
}

function stripDeleted(p: Project): Project {
  const copy = { ...p };
  delete copy.deletedAt;
  return copy;
}

/** The later edit wins; on a tie a tombstone wins (deleting is the deliberate act). */
function newer(a: Project, b: Project): boolean {
  const ta = latest(a);
  const tb = latest(b);
  if (ta !== tb) return ta > tb;
  return Boolean(a.deletedAt) && !b.deletedAt;
}

function latest(p: Project): string {
  return p.deletedAt && p.deletedAt > p.updatedAt ? p.deletedAt : p.updatedAt;
}

/**
 * Two copies of the registry (this device's and Drive's, or the agent's) merged by id: the later
 * edit of each project wins, a deletion included. Order-independent.
 */
export function mergeProjects(a: unknown, b: unknown): Project[] {
  return normalizeProjects([...normalizeProjects(a), ...normalizeProjects(b)]);
}

/** The projects that aren't deleted. */
export function liveProjects(items: Project[]): Project[] {
  return items.filter((p) => !p.deletedAt);
}

export function sameProjects(a: Project[], b: Project[]): boolean {
  return JSON.stringify(normalizeProjects(a)) === JSON.stringify(normalizeProjects(b));
}

/** A project id that exists and isn't deleted, else Default. */
export function resolveProjectId(items: Project[], id: unknown): string {
  return isProjectId(id) && liveProjects(items).some((p) => p.id === id) ? id : DEFAULT_PROJECT_ID;
}

/** Application records and jobs from before projects have none: they're Default's. */
export function projectOf(record: { projectId?: string | null } | null | undefined): string {
  return record?.projectId || DEFAULT_PROJECT_ID;
}

/** `chrome.storage.local` keys that hold project data (the rest — keys, settings, logs — are global). */
export const PROJECT_STORAGE_KEYS = new Set<string>([
  "profileCache",
  "cvMetaCache",
  "cvLibraryCache",
  "legendCache",
  "legendLibraryCache",
  "customFieldsCache",
  "languageLevelsCache",
  "faqAnswersCache",
  "generationRulesCache",
  "outreachRulesCache",
  "cvTemplatesCache",
  "lastCoverLetter",
  "jobSearchSuggestionCache",
  "driveSyncPending",
  // The statistics: which postings were worked on, per project.
  "activationLog",
  "agentBridgeSync",
  "agentBridgeSettingsHash",
]);

const KEY_PREFIX = /^p:([a-z0-9][a-z0-9-]{0,63}):(.+)$/;

/** The storage key of `key` in `projectId`: Default keeps the old name, others get `p:<id>:`. */
export function scopedStorageKey(key: string, projectId: string): string {
  if (projectId === DEFAULT_PROJECT_ID || !PROJECT_STORAGE_KEYS.has(key)) return key;
  return `p:${projectId}:${key}`;
}

/** `p:<id>:profileCache` → `profileCache` (a storage-change listener's view of a key). */
export function baseStorageKey(key: string): string {
  return KEY_PREFIX.exec(key)?.[2] ?? key;
}

/** Drive files every project shares: the applications (listed by the `applications/` name) and their documents, and the registry. */
export function isGlobalDriveName(name: string): boolean {
  return name === "projects.json" || name.startsWith("applications/") || name.startsWith("jobPosting/") || name.startsWith("adaptedCv/") || name.startsWith("projects/");
}

/** The Drive name of `name` in `projectId`: Default keeps the root name, others `projects/<id>/<name>`. */
export function scopedDriveName(name: string, projectId: string): string {
  if (projectId === DEFAULT_PROJECT_ID || isGlobalDriveName(name)) return name;
  return `projects/${projectId}/${name}`;
}

/** The name shown for a project: Default's stored name is translated while the user hasn't renamed it. */
export function projectLabel(project: Pick<Project, "id" | "name">, defaultLabel: string): string {
  return project.id === DEFAULT_PROJECT_ID && project.name === DEFAULT_PROJECT_NAME ? defaultLabel : project.name;
}
