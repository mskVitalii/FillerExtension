import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT_ID } from "@/features/projects/registry";

/**
 * A background run stays in the project it was started in (FillerAgent `docs/projects.md`): a cover
 * letter that is still streaming when the user switches project reads the starting project's
 * profile and writes its last letter there; a run of the other project waits until it's done.
 */

// ---- chrome.storage of one browser profile (Drive isn't reached: every document is cached) ----
const local = new Map<string, unknown>();
const session = new Map<string, unknown>();
function area(store: Map<string, unknown>) {
  return {
    get: async (keys?: string | string[] | null) => {
      const list = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => store.has(k)).map((k) => [k, structuredClone(store.get(k))]));
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v));
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}
vi.stubGlobal("chrome", {
  storage: {
    local: area(local),
    session: area(session),
    sync: area(new Map()),
    onChanged: { addListener: () => undefined, removeListener: () => undefined },
  },
  runtime: { sendMessage: vi.fn(async () => undefined), getURL: (p: string) => p, id: "test" },
  tabs: { get: vi.fn(async () => ({ id: 7, url: "https://jobs.example/1" })), sendMessage: vi.fn(async () => undefined) },
});
vi.mock("@/features/google-drive/auth", () => ({
  getGoogleToken: vi.fn(async () => {
    throw new Error("offline");
  }),
  isGoogleConnected: vi.fn(async () => false),
}));

// The pipeline waits for the test to switch project, then reads the profile like the real one does.
let release: () => void = () => undefined;
let started: () => void = () => undefined;
vi.mock("@/features/cover-letter/pipeline", () => ({
  runCoverLetterPipeline: vi.fn(async () => {
    started();
    await new Promise<void>((resolve) => (release = resolve));
    const { getApplicantContext } = await import("@/features/profile/context");
    const { profile } = await getApplicantContext();
    return { content: `Dear team, ${profile.firstName}`, slopFindings: [], cleaned: false };
  }),
}));

const { routeMessage } = await import("@/background/router");
const { runInProject } = await import("@/features/projects/scope");
const { getProfile } = await import("@/features/profile/repository");
const { EMPTY_PROFILE, EMPTY_JOB } = await (async () => ({ ...(await import("@/types/profile")), ...(await import("@/types/job")) }))();

const TEACHING = "p-teaching01";

beforeEach(() => {
  local.clear();
  session.clear();
  local.set("profileCache", { ...EMPTY_PROFILE, firstName: "Ada" });
  local.set(`p:${TEACHING}:profileCache`, { ...EMPTY_PROFILE, firstName: "Bea" });
});

const switchTo = (id: string) => (id === DEFAULT_PROJECT_ID ? local.delete("activeProjectId") : local.set("activeProjectId", id));

describe("a background run keeps its project", () => {
  it("a cover letter started in one project is written from and saved to it after a switch", async () => {
    const begun = new Promise<void>((resolve) => (started = resolve));
    const run = routeMessage({ type: "GENERATE_COVER_LETTER", tabId: 7, job: { ...EMPTY_JOB, url: "https://jobs.example/1" } });
    await begun;
    switchTo(TEACHING); // the user switches while the letter streams
    release();
    const result = await run;

    expect(result).toMatchObject({ type: "COVER_LETTER_RESULT", content: "Dear team, Ada" });
    expect(local.get("lastCoverLetter")).toBe("Dear team, Ada");
    expect(local.has(`p:${TEACHING}:lastCoverLetter`)).toBe(false);
    expect(session.get("coverLetterRun:7")).toMatchObject({ projectId: DEFAULT_PROJECT_ID, status: "done" });
    // Whatever runs next, unpinned, is the newly active project's.
    expect((await getProfile()).firstName).toBe("Bea");
  });

  it("follows the project the panel stamped on the request, not the active one", async () => {
    const begun = new Promise<void>((resolve) => (started = resolve));
    const run = routeMessage({ type: "GENERATE_COVER_LETTER", tabId: 7, job: EMPTY_JOB, projectId: TEACHING } as Parameters<typeof routeMessage>[0]);
    await begun;
    release();
    expect(await run).toMatchObject({ content: "Dear team, Bea" });
    expect(local.get(`p:${TEACHING}:lastCoverLetter`)).toBe("Dear team, Bea");
    expect(session.get("coverLetterRun:7")).toMatchObject({ projectId: TEACHING });
  });

  it("a run of another project waits for the pinned one, then reads its own data", async () => {
    const order: string[] = [];
    let finishFirst: () => void = () => undefined;
    const first = runInProject(DEFAULT_PROJECT_ID, async () => {
      await new Promise<void>((resolve) => (finishFirst = resolve));
      order.push(`default:${(await getProfile()).firstName}`);
    });
    const sameProject = runInProject(DEFAULT_PROJECT_ID, async () => {
      order.push(`default-too:${(await getProfile()).firstName}`);
    });
    const other = runInProject(TEACHING, async () => {
      order.push(`teaching:${(await getProfile()).firstName}`);
    });
    await sameProject; // the same project shares the pin
    expect(order).toEqual(["default-too:Ada"]);
    finishFirst();
    await Promise.all([first, other]);
    expect(order).toEqual(["default-too:Ada", "default:Ada", "teaching:Bea"]);
  });
});
