import { showPageToast } from "./page-toast";

/**
 * A generated password is the one value in this extension the user has no
 * other record of (unlike profile fields, which they already know) — so
 * every place that inserts one must also hand it back to the user, not just
 * type it into the page. This shows a small on-page toast with the value
 * and best-effort copies it to the clipboard.
 */
export async function announceGeneratedPassword(password: string): Promise<void> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(password);
    copied = true;
  } catch {
    // No clipboard permission in this context (e.g. transient activation
    // already expired by the time the background→content hop landed) —
    // the toast below still shows the value so the user can select it.
  }

  showPageToast(
    copied
      ? `Generated password copied to clipboard: ${password}`
      : `Generated password (copy not available): ${password}`,
  );
}
