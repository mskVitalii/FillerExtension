import { EMPTY_PROFILE, type CvMeta, type PersonalLegend, type Profile } from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import * as drive from "@/features/google-drive/client";

/**
 * Profile/CV/Personal Legend live in Google Drive appDataFolder (source of
 * truth) with a local cache for instant reads by Side Panel and Content
 * Script (spec sections 7-9, 20).
 */
export async function getProfile(): Promise<Profile> {
  const cached = await getLocal("profileCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<Profile>("profile.json");
    if (remote) {
      await setLocal("profileCache", remote);
      return remote;
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
