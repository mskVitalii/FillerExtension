import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LegendLibrary, LegendMeta } from "@/types/profile";

/**
 * Moving the extension to another browser: the Drive-backed documents
 * (Personal Legend library above all) must come back from Drive, not stay
 * hidden behind a local cache written before Google was connected, and a
 * change made in one browser must not overwrite what another one saved.
 */

/** In-memory Drive appDataFolder; `online` toggles "Google connected". */
const driveStore = new Map<string, unknown>();
let online = true;
function requireOnline() {
  if (!online) throw new Error("Google is not connected.");
}
vi.mock("@/features/google-drive/client", () => ({
  readJsonFile: vi.fn(async (name: string) => {
    requireOnline();
    const value = driveStore.get(name);
    return value === undefined ? null : structuredClone(value);
  }),
  writeJsonFile: vi.fn(async (name: string, value: unknown) => {
    requireOnline();
    driveStore.set(name, structuredClone(value));
    return name;
  }),
  readTextFile: vi.fn(async (name: string) => {
    requireOnline();
    return (driveStore.get(name) as string | undefined) ?? null;
  }),
  writeTextFile: vi.fn(async (name: string, content: string) => {
    requireOnline();
    driveStore.set(name, content);
    return name;
  }),
  readBinaryFile: vi.fn(async () => null),
  writeBinaryFile: vi.fn(async (name: string) => name),
  deleteFile: vi.fn(async (name: string) => {
    requireOnline();
    driveStore.delete(name);
  }),
}));
vi.mock("@/features/google-drive/auth", () => ({
  isGoogleConnected: vi.fn(async () => online),
}));

/** `chrome.storage.local` of one browser profile. */
let local = new Map<string, unknown>();
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (key: string) => (local.has(key) ? { [key]: structuredClone(local.get(key)) } : {}),
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) local.set(key, structuredClone(value));
      },
      remove: async (key: string) => {
        local.delete(key);
      },
    },
  },
});

const repo = await import("@/features/profile/repository");
const { refreshDriveCaches } = await import("@/features/storage/drive-cache");

function legend(id: string, content: string): LegendMeta {
  return { id, name: `Legend ${id}`, content, uploadedAt: "2026-11-01T00:00:00.000Z" };
}

/** A fresh browser: empty local storage, same Drive. */
function switchBrowser() {
  local = new Map();
}

beforeEach(() => {
  driveStore.clear();
  local = new Map();
  online = true;
});

describe("Personal Legend across browsers", () => {
  it("a new browser reads the library from Drive", async () => {
    await repo.createLegend("Mine", "I build things.");
    switchBrowser();
    expect((await repo.getPersonalLegend())?.content).toBe("I build things.");
  });

  it("opening the panel before connecting Google doesn't hide the Drive library afterwards", async () => {
    await repo.createLegend("Mine", "I build things.");
    switchBrowser();
    online = false;
    expect(await repo.getPersonalLegend()).toBeNull();
    online = true;
    expect((await repo.getPersonalLegend())?.content).toBe("I build things.");
  });

  it("recovers from an empty library an older build cached while offline", async () => {
    await repo.createLegend("Mine", "I build things.");
    switchBrowser();
    local.set("legendLibraryCache", { items: [], activeId: null } satisfies LegendLibrary);
    expect((await repo.getPersonalLegend())?.content).toBe("I build things.");
  });

  it("adding a legend in a browser with a stale cache keeps the ones saved elsewhere", async () => {
    await repo.createLegend("A", "from browser A");
    const browserA = local;
    switchBrowser();
    await repo.createLegend("B", "from browser B");
    local = browserA;
    await repo.createLegend("C", "from browser A again");
    const names = (driveStore.get("legendLibrary.json") as LegendLibrary).items.map((item) => item.name);
    expect(names).toEqual(["A", "B", "C"]);
  });

  it("refreshDriveCaches pulls another browser's edits into a warm cache", async () => {
    const created = await repo.createLegend("A", "old text");
    const browserA = local;
    switchBrowser();
    await repo.updateLegendContent(created.id, "new text");
    local = browserA;
    expect((await repo.getPersonalLegend())?.content).toBe("old text");
    expect(await refreshDriveCaches()).toBe(true);
    expect((await repo.getPersonalLegend())?.content).toBe("new text");
    expect(await refreshDriveCaches()).toBe(false);
  });
});

describe("edits made while Drive is unreachable", () => {
  it("are kept locally and pushed on the next refresh instead of being overwritten", async () => {
    driveStore.set("legendLibrary.json", { items: [legend("x", "drive copy")], activeId: "x" });
    await repo.getLegendLibrary();
    online = false;
    await expect(repo.saveGenerationRules("write shorter")).rejects.toThrow();
    // Each save fails on Drive but still lands in the local cache.
    await expect(repo.saveProfile({ ...(await repo.getProfile()), firstName: "Ada" })).rejects.toThrow();
    online = true;
    await refreshDriveCaches();
    expect(driveStore.get("generationRules.md")).toBe("write shorter");
    expect((driveStore.get("profile.json") as { firstName: string }).firstName).toBe("Ada");
    expect(local.get("driveSyncPending")).toEqual([]);
  });

  it("an offline change to the library isn't replaced by Drive's older copy", async () => {
    driveStore.set("legendLibrary.json", { items: [legend("x", "one"), legend("y", "two")], activeId: "x" });
    await repo.getLegendLibrary();
    online = false;
    await expect(repo.setActiveLegend("y")).rejects.toThrow();
    expect((await repo.getLegendLibrary()).activeId).toBe("y");
    online = true;
    expect((await repo.getLegendLibrary(true)).activeId).toBe("y");
    await refreshDriveCaches();
    expect((driveStore.get("legendLibrary.json") as LegendLibrary).activeId).toBe("y");
  });
});
