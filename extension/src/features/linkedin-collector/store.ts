import { canonicalJobUrl, dedupeJobLinks, jobIdFromHref, type LinkedInJobLink } from "./links";

/**
 * The LinkedIn jobs the user collected with the on-page "Add" buttons, in `chrome.storage.local`
 * (this browser only — a list of links, not a document worth a Drive copy). Written by the
 * background (`LINKEDIN_ADD_JOBS`), read and pruned by the Side Panel's Job Search screen.
 */

const STORAGE_KEY = "linkedinCollected";
/** Oldest entries fall off past this — a few pages of search results a day for weeks. */
export const MAX_COLLECTED = 1000;

export interface CollectedLinkedInJob extends LinkedInJobLink {
  /** The Job Search source chip (`JobSearchSource`): always "linkedin". */
  source: "linkedin";
  /** When it was first added (ms). */
  addedAt: number;
}

export async function getCollectedLinkedInJobs(): Promise<CollectedLinkedInJob[]> {
  const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
  return Array.isArray(stored) ? (stored as CollectedLinkedInJob[]) : [];
}

async function save(jobs: CollectedLinkedInJob[]): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: jobs.slice(-MAX_COLLECTED) });
}

/**
 * What the content script sent, re-validated: it runs in a page, so only a numeric id and short
 * plain-text fields survive, and the URL is rebuilt from the id.
 */
export function sanitizeIncoming(raw: unknown): LinkedInJobLink[] {
  if (!Array.isArray(raw)) return [];
  const text = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 200) : "");
  const links: LinkedInJobLink[] = [];
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" && /^\d{5,20}$/.test(record.id) ? record.id : jobIdFromHref(text(record.url));
    if (!id) continue;
    links.push({ id, url: canonicalJobUrl(id), title: text(record.title), company: text(record.company), location: text(record.location) });
  }
  return dedupeJobLinks(links);
}

/**
 * Pure merge: new ids are appended (in page order), known ones only get their empty fields filled.
 * Returns the ids that were new.
 */
export function mergeCollected(existing: CollectedLinkedInJob[], incoming: LinkedInJobLink[], now = Date.now()): { jobs: CollectedLinkedInJob[]; added: string[] } {
  const jobs = existing.map((job) => ({ ...job }));
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const added: string[] = [];
  for (const link of incoming) {
    const known = byId.get(link.id);
    if (known) {
      known.title ||= link.title;
      known.company ||= link.company;
      known.location ||= link.location;
      continue;
    }
    const job: CollectedLinkedInJob = { ...link, source: "linkedin", addedAt: now };
    jobs.push(job);
    byId.set(job.id, job);
    added.push(job.id);
  }
  return { jobs, added };
}

let queue: Promise<unknown> = Promise.resolve();

/** Serialized, so two quick clicks on two cards can't overwrite each other's write. */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

export function addCollectedLinkedInJobs(incoming: LinkedInJobLink[]): Promise<{ added: number; total: number; ids: string[] }> {
  return serialized(async () => {
    const { jobs, added } = mergeCollected(await getCollectedLinkedInJobs(), incoming);
    await save(jobs);
    const kept = jobs.slice(-MAX_COLLECTED);
    return { added: added.length, total: kept.length, ids: kept.map((job) => job.id) };
  });
}

export function removeCollectedLinkedInJobs(ids: string[] | "all"): Promise<void> {
  return serialized(async () => {
    if (ids === "all") return save([]);
    const drop = new Set(ids);
    await save((await getCollectedLinkedInJobs()).filter((job) => !drop.has(job.id)));
  });
}

export function onCollectedLinkedInJobsChanged(listener: (jobs: CollectedLinkedInJob[]) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && STORAGE_KEY in changes) {
      const value = changes[STORAGE_KEY].newValue;
      listener(Array.isArray(value) ? (value as CollectedLinkedInJob[]) : []);
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
