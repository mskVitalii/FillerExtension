import type { InsertField } from "@/features/autofill/insert-field-labels";
import { getCvMeta, getProfile } from "@/features/profile/repository";
import { getLocal } from "@/features/storage/local";
import { getTabState, setTabState } from "@/features/storage/session";
import { generatePassword } from "@/lib/generate-password";
import { canonicalPhone } from "@/lib/phone";

/** Resolves what text a context-menu "Insert" click should place into the page. */
export async function resolveInsertValue(field: InsertField, tabId: number): Promise<string> {
  if (field === "cv") {
    const cv = await getCvMeta();
    return cv?.text ?? "";
  }
  if (field === "coverLetter") {
    return (await getLocal("lastCoverLetter")) ?? "";
  }
  if (field === "generatePassword") {
    // Reuse the password already shown/copied in the Side Panel for this
    // tab, if there is one — inserting a *different* freshly-generated
    // value than what the user already saw or dragged elsewhere on the
    // same form would leave a password+confirm pair mismatched, or not
    // match what got copied to the clipboard.
    const cached = await getTabState(tabId);
    if (cached?.generatedPassword) return cached.generatedPassword;

    const password = generatePassword();
    // Only sync back into existing state — never create a partial one:
    // a TabState the panel hasn't written yet is missing required fields
    // (job, coverLetter, ...) that we can't safely default here.
    if (cached) await setTabState(tabId, { ...cached, generatedPassword: password });
    return password;
  }
  const profile = await getProfile();
  const value = profile[field] ?? "";
  // Hand the content script a canonical E.164 number so it can reformat to
  // whatever the field the user right-clicked expects (the target element
  // isn't known here in the background).
  if (field === "phone" && value) return canonicalPhone(value, profile.country);
  return value;
}
