import {
  EMPTY_PROFILE,
  type CustomField,
  type CvMeta,
  type LanguageLevel,
  type PersonalLegend,
  type Profile,
} from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import * as drive from "@/features/google-drive/client";

/**
 * Profile/CV/Personal Legend live in Google Drive appDataFolder (source of
 * truth) with a local cache for instant reads by Side Panel and Content
 * Script (spec sections 7-9, 20).
 */
export async function getProfile(): Promise<Profile> {
  // Merge over EMPTY_PROFILE so a profile saved before a new field existed
  // (e.g. `pronouns`) still comes back with every key defined.
  const cached = await getLocal("profileCache");
  if (cached) return { ...EMPTY_PROFILE, ...cached };
  try {
    const remote = await drive.readJsonFile<Profile>("profile.json");
    if (remote) {
      const merged = { ...EMPTY_PROFILE, ...remote };
      await setLocal("profileCache", merged);
      return merged;
    }
  } catch {
    // Google not connected yet — fall through to empty profile.
  }
  return EMPTY_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await setLocal("profileCache", profile);
  await drive.writeJsonFile("profile.json", profile);
}

export async function getPersonalLegend(): Promise<PersonalLegend | null> {
  const cached = await getLocal("legendCache");
  if (cached) return cached;
  try {
    const content = await drive.readTextFile("legend.md");
    if (content !== null) {
      const legend: PersonalLegend = { content, updatedAt: new Date().toISOString() };
      await setLocal("legendCache", legend);
      return legend;
    }
  } catch {
    // Google not connected yet.
  }
  return null;
}

export async function savePersonalLegend(content: string): Promise<void> {
  const legend: PersonalLegend = { content, updatedAt: new Date().toISOString() };
  await setLocal("legendCache", legend);
  await drive.writeTextFile("legend.md", content);
}

export async function getCvMeta(): Promise<CvMeta | null> {
  const cached = await getLocal("cvMetaCache");
  return cached ?? null;
}

export async function uploadCv(file: File, extractedText: string): Promise<CvMeta> {
  const driveFileId = await drive.writeBinaryFile("cv.pdf", file);
  const meta: CvMeta = {
    fileName: file.name,
    mimeType: file.type,
    driveFileId,
    text: extractedText,
    uploadedAt: new Date().toISOString(),
  };
  await setLocal("cvMetaCache", meta);
  return meta;
}

export async function getCvFile(): Promise<File | null> {
  const meta = await getCvMeta();
  if (!meta) return null;
  const blob = await drive.readBinaryFile("cv.pdf");
  if (!blob) return null;
  return new File([blob], meta.fileName, { type: meta.mimeType });
}

export async function deleteCv(): Promise<void> {
  await drive.deleteFile("cv.pdf");
  await chrome.storage.local.remove("cvMetaCache");
}

/**
 * Custom fields (spec_2 item 1) — same cache-then-Drive pattern as Profile,
 * but stored separately since they're drag-only and never fed into autofill.
 */
export async function getCustomFields(): Promise<CustomField[]> {
  const cached = await getLocal("customFieldsCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<CustomField[]>("customFields.json");
    if (remote) {
      await setLocal("customFieldsCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to empty list.
  }
  return [];
}

export async function saveCustomFields(fields: CustomField[]): Promise<void> {
  await setLocal("customFieldsCache", fields);
  await drive.writeJsonFile("customFields.json", fields);
}

/**
 * The user's own language levels (spec_3 item 2) — same cache-then-Drive pattern as
 * Custom Fields, compared against a posting's detected language requirements.
 */
export async function getLanguageLevels(): Promise<LanguageLevel[]> {
  const cached = await getLocal("languageLevelsCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<LanguageLevel[]>("languageLevels.json");
    if (remote) {
      await setLocal("languageLevelsCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to empty list.
  }
  return [];
}

export async function saveLanguageLevels(levels: LanguageLevel[]): Promise<void> {
  await setLocal("languageLevelsCache", levels);
  await drive.writeJsonFile("languageLevels.json", levels);
}
