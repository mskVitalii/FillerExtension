import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PROJECT_ID,
  mergeProjects,
  newProjectId,
  normalizeProjects,
  projectOf,
  scopedDriveName,
  scopedStorageKey,
  type Project,
} from "@/features/projects/registry";

/**
 * Projects (FillerAgent `docs/projects.md`): what this browser stored before projects is the
 * Default project and is read where it always was; another project has its own caches
 * (`p:<id>:…`), Drive files (`projects/<id>/…`) and "what I don't want"; an un-updated browser
 * keeps working on Default; the registry syncs through Drive `projects.json`.
 */

// ---- an in-memory appDataFolder behind the real Drive client (fetch) ----
const drive = new Map<string, string>();
let ids = 0;
const byId = new Map<string, string>();
async function fakeFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const m = /^\/(upload\/)?drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return new Response("not found", { status: 404 });
  const [, upload, id] = m;
  if (upload) {
    const form = init.body as FormData;
    const meta = JSON.parse(await (form.get("metadata") as Blob).text()) as { name: string };
    const body = await (form.get("file") as Blob).text();
    const fileId = id ?? `f${++ids}`;
    byId.set(fileId, meta.name);
    drive.set(meta.name, body);
    return Response.json({ id: fileId });
  }
  if (id && init.method === "DELETE") {
    drive.delete(byId.get(id) ?? "");
    return new Response(null, { status: 204 });
  }
  if (id) return new Response(drive.get(byId.get(id) ?? "") ?? "", { status: drive.has(byId.get(id) ?? "") ? 200 : 404 });
  const q = url.searchParams.get("q") ?? "";
  const name = /name = '((?:[^'\\]|\\.)+)'/.exec(q)?.[1]?.replace(/\\'/g, "'");
  const contains = /name contains '([^']+)'/.exec(q)?.[1];
  const files = [...drive.keys()].filter((n) => (contains ? n.includes(contains) : n === name)).map((n) => {
    let fileId = [...byId.entries()].find(([, v]) => v === n)?.[0];
    if (!fileId) {
      fileId = `f${++ids}`;
      byId.set(fileId, n);
    }
    return { id: fileId, name: n };
  });
  return Response.json({ files });
}
vi.stubGlobal("fetch", fakeFetch);
vi.mock("@/features/google-drive/auth", () => ({
  getGoogleToken: vi.fn(async () => "token"),
  isGoogleConnected: vi.fn(async () => true),
}));

// ---- chrome.storage of one browser profile ----
type Area = Map<string, unknown>;
let local: Area = new Map();
let sync: Area = new Map();
const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = [];
function area(get: () => Area, name: string) {
  return {
    get: async (keys?: string | string[] | null) => {
      const list = keys == null ? [...get().keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => get().has(k)).map((k) => [k, structuredClone(get().get(k))]));
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) get().set(k, structuredClone(v));
      for (const l of listeners) l(items, name);
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) get().delete(k);
    },
  };
}
vi.stubGlobal("chrome", {
  storage: {
    local: area(() => local, "local"),
    sync: area(() => sync, "sync"),
    onChanged: { addListener: (l: (typeof listeners)[number]) => listeners.push(l), removeListener: () => undefined },
  },
});

const repo = await import("@/features/profile/repository");
const store = await import("@/features/projects/store");
const prefs = await import("@/features/storage/sync");
const apps = await import("@/features/applications/repository");
const { refreshDriveCaches } = await import("@/features/storage/drive-cache");
const { EMPTY_PROFILE } = await import("@/types/profile");
const { EMPTY_JOB } = await import("@/types/job");

/** Another browser (or one that hasn't updated): its own storage, the same Drive. */
function switchBrowser() {
  local = new Map();
  sync = new Map();
}

beforeEach(() => {
  drive.clear();
  byId.clear();
  switchBrowser();
});

describe("registry rules", () => {
  const p = (id: string, updatedAt: string, extra: Partial<Project> = {}): Project => ({ id, name: id, createdAt: updatedAt, updatedAt, ...extra });

  it("always has Default, which can't be deleted", () => {
    expect(normalizeProjects(undefined).map((x) => x.id)).toEqual([DEFAULT_PROJECT_ID]);
    const merged = mergeProjects([p("default", "2026-01-01", { deletedAt: "2026-02-01" })], []);
    expect(merged[0]).toMatchObject({ id: "default" });
    expect(merged[0].deletedAt).toBeUndefined();
  });

  it("merges by id: the later edit wins, a later deletion too, in any order", () => {
    const a = [p("p-aaaaaaaaaa", "2026-11-01", { name: "Old" }), p("p-bbbbbbbbbb", "2026-11-01")];
    const b = [p("p-aaaaaaaaaa", "2026-11-02", { name: "New" }), p("p-bbbbbbbbbb", "2026-11-03", { deletedAt: "2026-11-03" }), p("p-cccccccccc", "2026-11-04")];
    for (const merged of [mergeProjects(a, b), mergeProjects(b, a)]) {
      expect(merged.find((x) => x.id === "p-aaaaaaaaaa")?.name).toBe("New");
      expect(merged.find((x) => x.id === "p-bbbbbbbbbb")?.deletedAt).toBe("2026-11-03");
      expect(merged.some((x) => x.id === "p-cccccccccc")).toBe(true);
    }
  });

  it("keeps Default's names and prefixes another project's; shared files stay shared", () => {
    expect(newProjectId()).toMatch(/^p-[a-z0-9]{10}$/);
    expect(scopedStorageKey("profileCache", DEFAULT_PROJECT_ID)).toBe("profileCache");
    expect(scopedStorageKey("profileCache", "p-x")).toBe("p:p-x:profileCache");
    expect(scopedStorageKey("openaiApiKey", "p-x")).toBe("openaiApiKey");
    expect(scopedDriveName("profile.json", DEFAULT_PROJECT_ID)).toBe("profile.json");
    expect(scopedDriveName("cv-1.pdf", "p-x")).toBe("projects/p-x/cv-1.pdf");
    for (const shared of ["applications/a.json", "adaptedCv/a.pdf", "jobPosting/a.md", "projects.json"]) expect(scopedDriveName(shared, "p-x")).toBe(shared);
    expect(projectOf({})).toBe(DEFAULT_PROJECT_ID);
  });
});

describe("migration: a browser from before projects", () => {
  it("reads its caches and Drive files as the Default project, unchanged", async () => {
    local.set("profileCache", { ...EMPTY_PROFILE, firstName: "Ada" });
    sync.set("preferences", { jobSearchNegativePrompt: "no sales" });
    expect((await store.listProjects()).map((x) => x.id)).toEqual([DEFAULT_PROJECT_ID]);
    expect(await store.getActiveProjectId()).toBe(DEFAULT_PROJECT_ID);
    expect((await repo.getProfile()).firstName).toBe("Ada");
    expect((await prefs.getPreferences()).jobSearchNegativePrompt).toBe("no sales");
    // A fresh browser of the same user finds Default's data at Drive's root.
    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: "Ada" });
    expect(drive.has("profile.json")).toBe(true);
    switchBrowser();
    expect((await repo.getProfile()).firstName).toBe("Ada");
  });
});

describe("isolation between projects", () => {
  it("gives a new project its own caches, Drive files and search preference; Default stays as it was", async () => {
    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: "Ada" });
    await prefs.setPreferences({ jobSearchNegativePrompt: "no sales", autoSelectCv: false });
    const teaching = await store.createProject("Teaching");
    await store.setActiveProject(teaching.id);

    // Empty to start with: nothing of Default's leaks in. Settings (autoSelectCv) are shared.
    expect((await repo.getProfile()).firstName).toBe("");
    expect((await prefs.getPreferences()).jobSearchNegativePrompt).toBe("");
    expect((await prefs.getPreferences()).autoSelectCv).toBe(false);

    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: "Bea" });
    await prefs.setPreferences({ jobSearchNegativePrompt: "no nights" });
    expect(local.get(`p:${teaching.id}:profileCache`)).toMatchObject({ firstName: "Bea" });
    expect(JSON.parse(drive.get(`projects/${teaching.id}/profile.json`)!)).toMatchObject({ firstName: "Bea" });
    expect(JSON.parse(drive.get("profile.json")!)).toMatchObject({ firstName: "Ada" });

    await store.setActiveProject(DEFAULT_PROJECT_ID);
    expect((await repo.getProfile()).firstName).toBe("Ada");
    expect((await prefs.getPreferences()).jobSearchNegativePrompt).toBe("no sales");
  });

  it("an un-updated browser editing the root files edits Default only", async () => {
    const teaching = await store.createProject("Teaching");
    await store.setActiveProject(teaching.id);
    await repo.saveProfile({ ...EMPTY_PROFILE, firstName: "Bea" });
    // The old browser knows nothing of projects: it writes profile.json at the root.
    drive.set("profile.json", JSON.stringify({ ...EMPTY_PROFILE, firstName: "Ada (old browser)" }));
    await refreshDriveCaches();
    expect((await repo.getProfile()).firstName).toBe("Bea");
    await store.setActiveProject(DEFAULT_PROJECT_ID);
    await refreshDriveCaches();
    expect((await repo.getProfile()).firstName).toBe("Ada (old browser)");
  });

  it("tags an application with its project and keeps it there when saved from another", async () => {
    const teaching = await store.createProject("Teaching");
    await store.setActiveProject(teaching.id);
    const job = { ...EMPTY_JOB, url: "https://school.example/1", company: "School", position: "Teacher" };
    await apps.saveCoverLetterDraft(job, "Dear school");
    await store.setActiveProject(DEFAULT_PROJECT_ID);
    await apps.saveCoverLetterDraft(job, "Dear school, again");
    const [saved] = await apps.getAllApplications();
    expect(saved).toMatchObject({ projectId: teaching.id, coverLetter: "Dear school, again" });
    // Records live at the shared root, where every project's duplicate check sees them.
    expect([...drive.keys()].some((n) => n.startsWith("applications/"))).toBe(true);
  });
});

describe("the project list across browsers", () => {
  it("brings projects made in another browser, and a deletion there moves this browser back to Default", async () => {
    const teaching = await store.createProject("Teaching");
    expect(JSON.parse(drive.get("projects.json")!).items.map((x: Project) => x.id)).toContain(teaching.id);

    switchBrowser();
    expect((await store.listProjects()).map((x) => x.id)).toEqual([DEFAULT_PROJECT_ID]);
    expect(await store.refreshProjects()).toBe(true);
    expect((await store.listProjects()).map((x) => x.name)).toEqual(["Default", "Teaching"]);
    await store.setActiveProject(teaching.id);
    const second = new Map(local);

    // Deleted in the first browser (its registry still has it).
    switchBrowser();
    await store.refreshProjects();
    await store.deleteProject(teaching.id);
    await expect(store.deleteProject(DEFAULT_PROJECT_ID)).rejects.toThrow(/can't be deleted/);

    local = second;
    expect(await store.getActiveProjectId()).toBe(teaching.id);
    expect(await store.refreshProjects()).toBe(true);
    expect(await store.getActiveProjectId()).toBe(DEFAULT_PROJECT_ID);
    expect((await store.listProjects()).map((x) => x.id)).toEqual([DEFAULT_PROJECT_ID]);
  });
});
