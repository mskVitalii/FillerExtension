/** Stable, deterministic application id derived from the job URL — re-opening the same posting resolves to the same Drive record instead of creating a duplicate. */
export async function applicationIdForUrl(url: string): Promise<string> {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 16);
}
