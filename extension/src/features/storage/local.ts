import type { CvMeta, PersonalLegend, Profile } from "@/types/profile";

/**
 * chrome.storage.local — small local-only data: the user's OpenAI API key
 * and offline caches of Drive-backed documents (spec section 20).
 * Never store large documents here; the source of truth for CV/legend/
 * profile is Google Drive appDataFolder.
 */
interface LocalStorageSchema {
  openaiApiKey: string;
  profileCache: Profile;
  cvMetaCache: CvMeta;
  legendCache: PersonalLegend;
  /** Most recently generated/edited cover letter, so the context menu can insert it. */
  lastCoverLetter: string;
}

export async function getLocal<K extends keyof LocalStorageSchema>(
  key: K,
): Promise<LocalStorageSchema[K] | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

export async function setLocal<K extends keyof LocalStorageSchema>(
  key: K,
  value: LocalStorageSchema[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal<K extends keyof LocalStorageSchema>(key: K): Promise<void> {
  await chrome.storage.local.remove(key);
}

export async function getOpenAiApiKey(): Promise<string | undefined> {
  return getLocal("openaiApiKey");
}

export async function setOpenAiApiKey(key: string): Promise<void> {
  await setLocal("openaiApiKey", key);
}

export async function deleteOpenAiApiKey(): Promise<void> {
  await removeLocal("openaiApiKey");
}
