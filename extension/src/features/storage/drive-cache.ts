import * as drive from "@/features/google-drive/client";
import { isGoogleConnected } from "@/features/google-drive/auth";
import { getLocal, setLocal, type LocalStorageSchema } from "./local";

/**
 * The cache-then-Drive pattern every Drive-backed document follows (spec
 * section 20): read the `chrome.storage.local` cache first, fall back to the
 * Drive appDataFolder file, populate the cache on a hit, and come back
 * `undefined` when neither has it — including when Google isn't connected yet.
 *
 * Cache-first alone never notices an edit made in another browser, so
 * `refreshDriveCaches` (run when the Side Panel opens and right after
 * "Connect Google") pulls every document below back from Drive.
 */

/** Cache keys holding a plain-text Drive document (`.md`) wrapped as `{ content, updatedAt }`. */
type TextCacheKey = "generationRulesCache" | "outreachRulesCache";

type DriveDoc =
  | { cacheKey: Exclude<keyof LocalStorageSchema, TextCacheKey>; fileName: string; kind: "json" }
  | { cacheKey: TextCacheKey; fileName: string; kind: "text" };

/** Every Drive-backed document that has a local cache — what `refreshDriveCaches` keeps in step with Drive. */
const DRIVE_DOCS: DriveDoc[] = [
  { cacheKey: "profileCache", fileName: "profile.json", kind: "json" },
  { cacheKey: "cvLibraryCache", fileName: "cvLibrary.json", kind: "json" },
  { cacheKey: "legendLibraryCache", fileName: "legendLibrary.json", kind: "json" },
  { cacheKey: "customFieldsCache", fileName: "customFields.json", kind: "json" },
  { cacheKey: "languageLevelsCache", fileName: "languageLevels.json", kind: "json" },
  { cacheKey: "faqAnswersCache", fileName: "faq.json", kind: "json" },
  { cacheKey: "cvTemplatesCache", fileName: "cvTemplates.json", kind: "json" },
  { cacheKey: "generationRulesCache", fileName: "generationRules.md", kind: "text" },
  { cacheKey: "outreachRulesCache", fileName: "outreachRules.md", kind: "text" },
];

// Serializes read-modify-writes of `driveSyncPending` within this context.
let pendingQueue: Promise<unknown> = Promise.resolve();

function updatePending(update: (keys: Set<string>) => void): Promise<void> {
  const next = pendingQueue.then(async () => {
    const stored = (await getLocal("driveSyncPending")) ?? [];
    const keys = new Set(stored);
    update(keys);
    if (keys.size === stored.length && stored.every((key) => keys.has(key))) return;
    await setLocal("driveSyncPending", [...keys]);
  });
  pendingQueue = next.catch(() => undefined);
  return next;
}

/** True while this device holds an edit of `cacheKey` that never reached Drive — the local copy is then the newer one. */
export async function isDrivePending(cacheKey: keyof LocalStorageSchema): Promise<boolean> {
  return ((await getLocal("driveSyncPending")) ?? []).includes(cacheKey);
}

/** Runs a Drive write for `cacheKey`, remembering a failure so the local edit is pushed later instead of being overwritten. */
async function pushToDrive(cacheKey: keyof LocalStorageSchema, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    await updatePending((keys) => keys.add(cacheKey));
    throw err;
  }
  await updatePending((keys) => keys.delete(cacheKey));
}

/** A Drive read that tells "Drive has no such file" (`value: null`) apart from "Drive can't be reached" — only the first may be cached. */
export type DriveRead<T> = { reachable: false } | { reachable: true; value: T | null };

export async function tryReadDriveJson<T>(fileName: string): Promise<DriveRead<T>> {
  try {
    return { reachable: true, value: await drive.readJsonFile<T>(fileName) };
  } catch {
    return { reachable: false };
  }
}

export async function readCachedJson<K extends keyof LocalStorageSchema>(
  cacheKey: K,
  fileName: string,
): Promise<LocalStorageSchema[K] | undefined> {
  const cached = await getLocal(cacheKey);
  if (cached) return cached;
  const remote = await tryReadDriveJson<LocalStorageSchema[K]>(fileName);
  if (remote.reachable && remote.value) {
    await setLocal(cacheKey, remote.value);
    return remote.value;
  }
  return undefined;
}

/** Writes the local cache first, so the edit stays on this device even when the Drive write fails. */
export async function writeCachedJson<K extends keyof LocalStorageSchema>(
  cacheKey: K,
  fileName: string,
  value: LocalStorageSchema[K],
): Promise<void> {
  await setLocal(cacheKey, value);
  await pushToDrive(cacheKey, () => drive.writeJsonFile(fileName, value));
}

/** {@link readCachedJson} for a Markdown document; `updatedAt` is the time it was read from Drive. */
export async function readCachedText(cacheKey: TextCacheKey, fileName: string): Promise<LocalStorageSchema[TextCacheKey] | null> {
  const cached = await getLocal(cacheKey);
  if (cached) return cached;
  try {
    const content = await drive.readTextFile(fileName);
    if (content !== null) {
      const doc = { content, updatedAt: new Date().toISOString() };
      await setLocal(cacheKey, doc);
      return doc;
    }
  } catch {
    // Google not connected yet.
  }
  return null;
}

export async function writeCachedText(cacheKey: TextCacheKey, fileName: string, content: string): Promise<void> {
  await setLocal(cacheKey, { content, updatedAt: new Date().toISOString() });
  await pushToDrive(cacheKey, () => drive.writeTextFile(fileName, content));
}

/** Brings one cached document in step with Drive; true when the local cache changed. */
async function refreshDoc(doc: DriveDoc): Promise<boolean> {
  const local = await getLocal(doc.cacheKey);
  if (await isDrivePending(doc.cacheKey)) {
    // This device's copy is newer — upload it rather than pull Drive's over it.
    if (local == null) return false;
    const write =
      doc.kind === "text"
        ? () => drive.writeTextFile(doc.fileName, (local as LocalStorageSchema[TextCacheKey]).content)
        : () => drive.writeJsonFile(doc.fileName, local);
    await pushToDrive(doc.cacheKey, write);
    return false;
  }
  if (doc.kind === "text") {
    const content = await drive.readTextFile(doc.fileName);
    if (content === null || (local as LocalStorageSchema[TextCacheKey] | undefined)?.content === content) return false;
    await setLocal(doc.cacheKey, { content, updatedAt: new Date().toISOString() });
    return true;
  }
  const remote = await drive.readJsonFile<unknown>(doc.fileName);
  // No Drive file: keep whatever this device has rather than drop it.
  if (remote === null || JSON.stringify(remote) === JSON.stringify(local)) return false;
  await setLocal(doc.cacheKey, remote as never);
  return true;
}

/**
 * Re-reads every Drive-backed document into its local cache, so this browser
 * sees what was saved from another one, and pushes edits this device made
 * while Drive was unreachable. Returns true when any cache changed (the
 * caller then reloads what it shows). A no-op while Google isn't connected;
 * a document whose Drive call fails keeps its cache as it was.
 */
export async function refreshDriveCaches(): Promise<boolean> {
  if (!(await isGoogleConnected())) return false;
  const changed = await Promise.all(DRIVE_DOCS.map((doc) => refreshDoc(doc).catch(() => false)));
  return changed.some(Boolean);
}
