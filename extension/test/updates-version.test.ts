import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  isNewerVersion,
  parseVersion,
  selectLatestRelease,
  versionFromTag,
  type GitHubRelease,
} from "@/features/updates/version";

function release(tag: string, overrides: Partial<GitHubRelease> = {}): GitHubRelease {
  return {
    tag_name: tag,
    name: tag,
    html_url: `https://github.com/mskVitalii/FillerExtension/releases/tag/${tag}`,
    draft: false,
    prerelease: false,
    published_at: "2026-11-24T00:00:00Z",
    assets: [
      {
        name: "extension.zip",
        state: "uploaded",
        browser_download_url: `https://github.com/mskVitalii/FillerExtension/releases/download/${tag}/extension.zip`,
      },
    ],
    ...overrides,
  };
}

/** What the repo actually held before this scheme: higher numbers, no prefix, no asset. */
const LEGACY = [release("v4.0.0", { assets: [] }), release("3.2.0", { assets: [] })];

describe("semver comparison", () => {
  it("parses Chrome manifest versions only", () => {
    expect(parseVersion("1.1.15")).toEqual([1, 1, 15]);
    expect(parseVersion("2")).toEqual([2]);
    expect(parseVersion("1.2.3.4")).toEqual([1, 2, 3, 4]);
    expect(parseVersion("v1.2.3")).toBeNull();
    expect(parseVersion("1.2.3-beta")).toBeNull();
    expect(parseVersion("1..2")).toBeNull();
    expect(parseVersion("")).toBeNull();
  });

  it("compares numerically, not as strings", () => {
    expect(compareVersions("1.1.10", "1.1.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("2.0.0", "1.99.99")).toBe(1);
    expect(compareVersions("1.1.15", "1.1.15")).toBe(0);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0.1", "1.2.0")).toBe(1);
  });

  it("sorts unparseable versions lowest and never calls them newer", () => {
    expect(compareVersions("garbage", "1.0.0")).toBeLessThan(0);
    expect(isNewerVersion("garbage", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.1.16", "1.1.15")).toBe(true);
    expect(isNewerVersion("1.1.15", "1.1.15")).toBe(false);
    expect(isNewerVersion("1.1.14", "1.1.15")).toBe(false);
  });

  it("reads versions only from extension-v tags", () => {
    expect(versionFromTag("extension-v1.2.3")).toBe("1.2.3");
    expect(versionFromTag("v4.0.0")).toBeNull();
    expect(versionFromTag("3.2.0")).toBeNull();
    expect(versionFromTag("extension-v1.2.3-rc1")).toBeNull();
    expect(versionFromTag("extension-vlatest")).toBeNull();
  });
});

describe("release selection", () => {
  it("ignores the legacy v4.0.0 / 3.2.0 releases", () => {
    expect(selectLatestRelease(LEGACY)).toBeNull();
  });

  it("picks the highest extension-v release, regardless of list order", () => {
    const latest = selectLatestRelease([
      ...LEGACY,
      release("extension-v1.1.16"),
      release("extension-v1.1.20"),
      release("extension-v1.1.9"),
    ]);
    expect(latest?.version).toBe("1.1.20");
    expect(latest?.tag).toBe("extension-v1.1.20");
    expect(latest?.zipUrl).toBe(
      "https://github.com/mskVitalii/FillerExtension/releases/download/extension-v1.1.20/extension.zip",
    );
    expect(latest?.notesUrl).toBe("https://github.com/mskVitalii/FillerExtension/releases/tag/extension-v1.1.20");
  });

  it("skips drafts, prereleases and releases without an uploaded extension.zip", () => {
    const latest = selectLatestRelease([
      release("extension-v1.1.16"),
      release("extension-v1.3.0", { draft: true }),
      release("extension-v1.2.9", { prerelease: true }),
      release("extension-v1.2.8", { assets: [] }),
      release("extension-v1.2.7", {
        assets: [{ name: "other.zip", browser_download_url: "https://example.com/other.zip" }],
      }),
      release("extension-v1.2.6", {
        assets: [{ name: "extension.zip", state: "new", browser_download_url: "https://example.com/x.zip" }],
      }),
    ]);
    expect(latest?.version).toBe("1.1.16");
  });

  it("tolerates junk entries", () => {
    expect(selectLatestRelease([{} as GitHubRelease, release("extension-v1.0.1")])?.version).toBe("1.0.1");
  });
});

describe("runUpdateCheck (GitHub path)", () => {
  let storage: Record<string, unknown>;
  let badge: string;
  let manifest: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storage = {};
    badge = "";
    manifest = { version: "1.1.15" };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => manifest },
      storage: {
        local: {
          get: async (keys: string | string[]) =>
            Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((k) => k in storage).map((k) => [k, storage[k]])),
          set: async (items: Record<string, unknown>) => void Object.assign(storage, structuredClone(items)),
        },
      },
      action: {
        setBadgeText: async ({ text }: { text: string }) => void (badge = text),
        setBadgeBackgroundColor: async () => undefined,
        setBadgeTextColor: async () => undefined,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const ok = (body: unknown, etag = '"abc"') =>
    new Response(JSON.stringify(body), { status: 200, headers: { ETag: etag } });

  it("shows NEW for a newer extension-v release and not for the legacy ones", async () => {
    const { runUpdateCheck } = await import("@/features/updates/check");
    fetchMock.mockResolvedValueOnce(ok(LEGACY));
    let snapshot = await runUpdateCheck({ force: true });
    expect(snapshot.offer).toBeNull();
    expect(badge).toBe("");

    fetchMock.mockResolvedValueOnce(ok([...LEGACY, release("extension-v1.1.16")], '"def"'));
    snapshot = await runUpdateCheck({ force: true });
    expect(snapshot.offer).toMatchObject({ kind: "github", version: "1.1.16" });
    expect(badge).toBe("NEW");
    expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBe('"abc"');
  });

  it("keeps the cached release on a 304 and on errors", async () => {
    const { runUpdateCheck } = await import("@/features/updates/check");
    fetchMock.mockResolvedValueOnce(ok([release("extension-v1.1.16")]));
    await runUpdateCheck({ force: true });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 304 }));
    expect((await runUpdateCheck({ force: true })).offer?.version).toBe("1.1.16");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const failed = await runUpdateCheck({ force: true });
    expect(failed.offer?.version).toBe("1.1.16");
    expect(failed.state?.error).toBe("Failed to fetch");
    expect(badge).toBe("NEW");
  });

  it("throttles unforced checks", async () => {
    const { runUpdateCheck } = await import("@/features/updates/check");
    fetchMock.mockResolvedValueOnce(ok([]));
    await runUpdateCheck();
    await runUpdateCheck();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears the badge on dismiss and once the installed version is current", async () => {
    const { dismissUpdate, runUpdateCheck, syncUpdateBadge } = await import("@/features/updates/check");
    fetchMock.mockResolvedValueOnce(ok([release("extension-v1.1.16")]));
    await runUpdateCheck({ force: true });
    expect(badge).toBe("NEW");
    await dismissUpdate("1.1.16");
    expect(badge).toBe("");

    storage.updateDismissedVersion = undefined;
    await syncUpdateBadge();
    expect(badge).toBe("NEW");
    manifest.version = "1.1.16";
    await syncUpdateBadge();
    expect(badge).toBe("");
  });

  it("never asks GitHub for a Web Store install", async () => {
    manifest.update_url = "https://clients2.google.com/service/update2/crx";
    const requestUpdateCheck = vi.fn(async () => ({ status: "update_available", version: "1.2.0" }));
    (chrome.runtime as unknown as Record<string, unknown>).requestUpdateCheck = requestUpdateCheck;
    const { runUpdateCheck } = await import("@/features/updates/check");
    const snapshot = await runUpdateCheck({ force: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(snapshot.offer).toEqual({ kind: "store", version: "1.2.0" });
    expect(badge).toBe("NEW");
  });
});
