import {
  RELEASES_API_URL,
  isNewerVersion,
  selectLatestRelease,
  type ExtensionRelease,
  type GitHubRelease,
} from "./version";

/**
 * "Is there a newer Filler?" — shared by the service worker (install/startup
 * and a `chrome.alarms` alarm, `background/updates.ts`) and the Side Panel
 * (on open, and Settings → "Check for updates"). Extension-only: it uses
 * `chrome.action`/`chrome.runtime`, so FillerAgent must not import it.
 *
 * Nothing is held in memory: the result lives in `chrome.storage.local` and
 * the badge is re-derived from it on every event (see `docs/updates.md`).
 *
 * Two install sources, two mechanisms:
 * - Unpacked / zip build (no `update_url` in the manifest): GitHub releases
 *   tagged `extension-vX.Y.Z` with an `extension.zip` asset (`version.ts`).
 *   The API sends `Access-Control-Allow-Origin: *` and allows `If-None-Match`,
 *   so this needs no host permission; the ETag makes repeat checks a 304
 *   that doesn't count against GitHub's 60/h anonymous rate limit.
 * - Chrome Web Store (`update_url` present): never GitHub — Chrome's own
 *   `requestUpdateCheck`/`onUpdateAvailable`, and "Reload to update".
 */

const STATE_KEY = "updateCheck";
const DISMISSED_KEY = "updateDismissedVersion";
const STORE_VERSION_KEY = "storeUpdateVersion";

/** Don't re-ask GitHub more often than this unless the user asked (`force`). */
const MIN_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const BADGE_TEXT = "NEW";
const BADGE_COLOR = "#2563eb";

export interface UpdateCheckState {
  /** ms since epoch of the last completed (or failed) check. */
  checkedAt: number;
  /** ETag of the last 200 from the releases API, sent back as If-None-Match. */
  etag: string | null;
  /** Newest `extension-v*` release seen, newer than the installed version or not. */
  latest: ExtensionRelease | null;
  /** Why the last check failed (network, rate limit…), null when it worked. */
  error: string | null;
}

/** What the panel can offer, if anything. */
export type UpdateOffer =
  | { kind: "github"; version: string; release: ExtensionRelease }
  | { kind: "store"; version: string };

export interface UpdateSnapshot {
  currentVersion: string;
  storeInstall: boolean;
  state: UpdateCheckState | null;
  offer: UpdateOffer | null;
  dismissedVersion: string | null;
}

export function currentVersion(): string {
  return chrome.runtime.getManifest().version;
}

/** Chrome adds `update_url` to the manifest of a Web Store install; an unpacked build has none. */
export function isStoreInstall(): boolean {
  return "update_url" in chrome.runtime.getManifest();
}

export async function getUpdateSnapshot(): Promise<UpdateSnapshot> {
  const stored = await chrome.storage.local.get([STATE_KEY, DISMISSED_KEY, STORE_VERSION_KEY]);
  const state = (stored[STATE_KEY] as UpdateCheckState | undefined) ?? null;
  const dismissedVersion = (stored[DISMISSED_KEY] as string | undefined) ?? null;
  const storeVersion = (stored[STORE_VERSION_KEY] as string | undefined) ?? null;
  const version = currentVersion();
  const storeInstall = isStoreInstall();
  let offer: UpdateOffer | null = null;
  if (storeInstall) {
    if (storeVersion && isNewerVersion(storeVersion, version)) offer = { kind: "store", version: storeVersion };
  } else if (state?.latest && isNewerVersion(state.latest.version, version)) {
    offer = { kind: "github", version: state.latest.version, release: state.latest };
  }
  return { currentVersion: version, storeInstall, state, offer, dismissedVersion };
}

/** Keys whose change means the snapshot changed — the panel re-reads on these. */
export const UPDATE_STORAGE_KEYS = [STATE_KEY, DISMISSED_KEY, STORE_VERSION_KEY] as const;

/** NEW on the toolbar icon while an update is offered and not dismissed; cleared otherwise. */
export async function syncUpdateBadge(): Promise<void> {
  const { offer, dismissedVersion } = await getUpdateSnapshot();
  const show = offer !== null && offer.version !== dismissedVersion;
  await chrome.action.setBadgeText({ text: show ? BADGE_TEXT : "" });
  if (show) {
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    // Chrome 110+; older Chromes pick a readable text color themselves.
    await chrome.action.setBadgeTextColor?.({ color: "#ffffff" })?.catch(() => undefined);
  }
}

/** Hides the banner and the badge for this version; a newer one shows them again. */
export async function dismissUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ [DISMISSED_KEY]: version });
  await syncUpdateBadge();
}

/** Chrome told us (`onUpdateAvailable`, or a `requestUpdateCheck`) that the Web Store has `version`. */
export async function recordStoreUpdate(version: string): Promise<void> {
  await chrome.storage.local.set({ [STORE_VERSION_KEY]: version });
  await syncUpdateBadge();
}

export async function runUpdateCheck(options: { force?: boolean } = {}): Promise<UpdateSnapshot> {
  const previous = ((await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as UpdateCheckState | undefined) ?? null;
  const fresh = previous && !previous.error && Date.now() - previous.checkedAt < MIN_CHECK_INTERVAL_MS;
  if (!options.force && fresh) {
    await syncUpdateBadge();
    return getUpdateSnapshot();
  }
  const next = isStoreInstall() ? await checkStore(previous) : await checkGitHub(previous);
  await chrome.storage.local.set({ [STATE_KEY]: next });
  await syncUpdateBadge();
  return getUpdateSnapshot();
}

async function checkStore(previous: UpdateCheckState | null): Promise<UpdateCheckState> {
  const base: UpdateCheckState = { checkedAt: Date.now(), etag: null, latest: previous?.latest ?? null, error: null };
  try {
    const result = await chrome.runtime.requestUpdateCheck();
    if (result.status === "update_available" && result.version) await recordStoreUpdate(result.version);
    // "throttled" is normal (Chrome rate-limits these); its own schedule still updates the extension.
    return base;
  } catch (error) {
    return { ...base, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkGitHub(previous: UpdateCheckState | null): Promise<UpdateCheckState> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  // Only revalidate when the parsed result the ETag stands for is still here.
  if (previous?.etag && previous.latest !== undefined && !previous.error) headers["If-None-Match"] = previous.etag;
  const kept = { latest: previous?.latest ?? null, etag: previous?.etag ?? null };
  try {
    // no-store: the ETag is ours to send; the HTTP cache would answer 200 from itself instead.
    const response = await fetch(RELEASES_API_URL, { headers, cache: "no-store" });
    if (response.status === 304) return { checkedAt: Date.now(), ...kept, error: null };
    if (!response.ok) {
      const remaining = response.headers.get("X-RateLimit-Remaining");
      const reason = remaining === "0" ? "GitHub rate limit reached" : `GitHub answered ${response.status}`;
      return { checkedAt: Date.now(), ...kept, error: reason };
    }
    const releases = (await response.json()) as GitHubRelease[];
    if (!Array.isArray(releases)) return { checkedAt: Date.now(), ...kept, error: "Unexpected GitHub response" };
    return {
      checkedAt: Date.now(),
      etag: response.headers.get("ETag"),
      latest: selectLatestRelease(releases),
      error: null,
    };
  } catch (error) {
    return { checkedAt: Date.now(), ...kept, error: error instanceof Error ? error.message : String(error) };
  }
}
