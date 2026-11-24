/**
 * Pure version logic for the update check (no `chrome.*`, so it's unit
 * tested directly — see `test/updates-version.test.ts` and `docs/updates.md`).
 *
 * Only GitHub releases tagged `extension-vX.Y.Z` that are published (not
 * draft, not prerelease) and carry an `extension.zip` asset count as an
 * extension update. The repo also holds older, unrelated releases (`v4.0.0`,
 * `3.2.0`) whose numbers are higher than the extension's own 1.x line — a
 * check that took "the latest release" would announce one of them forever.
 */

export const RELEASES_API_URL = "https://api.github.com/repos/mskVitalii/FillerExtension/releases?per_page=100";
export const RELEASE_TAG_PREFIX = "extension-v";
export const RELEASE_ASSET_NAME = "extension.zip";

/** The handful of fields of a GitHub "release" object the check reads. */
export interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at?: string | null;
  assets: { name: string; browser_download_url: string; state?: string }[];
}

/** An extension release the panel can offer. */
export interface ExtensionRelease {
  version: string;
  tag: string;
  name: string;
  /** The release page on GitHub (its notes). */
  notesUrl: string;
  /** Direct download of the `extension.zip` asset. */
  zipUrl: string;
  publishedAt: string | null;
}

/**
 * "1.2.3" → [1, 2, 3]. Chrome's own manifest version format: one to four
 * dot-separated non-negative integers, no prerelease suffix. Anything else → null.
 */
export function parseVersion(text: string): number[] | null {
  const trimmed = text.trim();
  if (!/^\d+(\.\d+){0,3}$/.test(trimmed)) return null;
  return trimmed.split(".").map(Number);
}

/** <0 when a is older than b, 0 when equal ("1.2" == "1.2.0"), >0 when newer. Unparseable sorts lowest. */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return (left ? 1 : 0) - (right ? 1 : 0);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

/** `extension-v1.2.3` → "1.2.3"; any other tag → null. */
export function versionFromTag(tag: string): string | null {
  if (!tag.startsWith(RELEASE_TAG_PREFIX)) return null;
  const version = tag.slice(RELEASE_TAG_PREFIX.length);
  return parseVersion(version) ? version : null;
}

/** The highest-versioned published `extension-vX.Y.Z` release with an `extension.zip`, or null. */
export function selectLatestRelease(releases: readonly GitHubRelease[]): ExtensionRelease | null {
  let best: ExtensionRelease | null = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease) continue;
    const version = versionFromTag(release.tag_name ?? "");
    if (!version) continue;
    const asset = (release.assets ?? []).find(
      (item) => item.name === RELEASE_ASSET_NAME && (item.state === undefined || item.state === "uploaded"),
    );
    if (!asset) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = {
      version,
      tag: release.tag_name,
      name: release.name || release.tag_name,
      notesUrl: release.html_url,
      zipUrl: asset.browser_download_url,
      publishedAt: release.published_at ?? null,
    };
  }
  return best;
}
