import type { ProfileFieldKey } from "@/types/profile";
import { getCvMeta, getProfile } from "@/features/profile/repository";
import { getLocal } from "@/features/storage/local";

/** Resolves what text a context-menu "Insert" click should place into the page. */
export async function resolveInsertValue(field: ProfileFieldKey | "cv" | "coverLetter"): Promise<string> {
  if (field === "cv") {
    const cv = await getCvMeta();
    return cv?.text ?? "";
  }
  if (field === "coverLetter") {
    return (await getLocal("lastCoverLetter")) ?? "";
  }
  const profile = await getProfile();
  return profile[field] ?? "";
}
