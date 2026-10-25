import * as drive from "@/features/google-drive/client";
import { getLocal, setLocal, type LocalStorageSchema } from "./local";

/**
 * The cache-then-Drive pattern every Drive-backed document follows (spec
 * section 20): read the `chrome.storage.local` cache first, fall back to the
 * Drive appDataFolder file, populate the cache on a hit, and come back
 * `undefined` when neither has it — including when Google isn't connected yet.
 */
export async function readCachedJson<K extends keyof LocalStorageSchema>(
  cacheKey: K,
  fileName: string,
): Promise<LocalStorageSchema[K] | undefined> {
  const cached = await getLocal(cacheKey);
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<LocalStorageSchema[K]>(fileName);
    if (remote) {
      await setLocal(cacheKey, remote);
      return remote;
    }
  } catch {
    // Google not connected yet.
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
  await drive.writeJsonFile(fileName, value);
}

/** Cache keys holding a plain-text Drive document (`.md`) wrapped as `{ content, updatedAt }`. */
type TextCacheKey = "generationRulesCache" | "outreachRulesCache";

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
  await drive.writeTextFile(fileName, content);
}
