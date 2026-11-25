import { afterEach, describe, expect, it, vi } from "vitest";
import { LINKEDIN_SCRIPT_ID, syncLinkedInCollector } from "@/features/linkedin-collector/registration";

/** A chrome stub whose script registry behaves like Chrome's: a second register of the same id throws. */
function stubChrome(options: { granted: boolean; enabled: boolean; registered?: string[] }) {
  const registered = new Set(options.registered ?? []);
  const register = vi.fn(async (scripts: { id: string }[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (const { id } of scripts) {
      if (registered.has(id)) throw new Error(`Duplicate script ID '${id}'`);
      registered.add(id);
    }
  });
  vi.stubGlobal("chrome", {
    permissions: { contains: async () => options.granted },
    storage: { local: { get: async () => ({ linkedinCollector: { enabled: options.enabled } }) } },
    scripting: {
      getRegisteredContentScripts: async ({ ids }: { ids: string[] }) => ids.filter((id) => registered.has(id)).map((id) => ({ id })),
      registerContentScripts: register,
      unregisterContentScripts: vi.fn(async ({ ids }: { ids: string[] }) => ids.forEach((id) => registered.delete(id))),
      executeScript: vi.fn(async () => []),
    },
    tabs: { query: async () => [], sendMessage: vi.fn(async () => undefined) },
  });
  return { registered, register };
}

describe("LinkedIn collector registration", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers once when the permission grant and the switch fire their syncs together", async () => {
    const { registered, register } = stubChrome({ granted: true, enabled: true });
    const results = await Promise.all([syncLinkedInCollector(), syncLinkedInCollector(), syncLinkedInCollector()]);
    expect(results).toEqual(["registered", "unchanged", "unchanged"]);
    expect(register).toHaveBeenCalledTimes(1);
    expect([...registered]).toEqual([LINKEDIN_SCRIPT_ID]);
  });

  it("treats a script registered behind its back as registered, not an error", async () => {
    const { register } = stubChrome({ granted: true, enabled: true });
    // Chrome's registry already has it, but getRegisteredContentScripts said no (another worker raced it).
    (chrome.scripting.getRegisteredContentScripts as unknown as () => Promise<unknown[]>) = async () => [];
    register.mockRejectedValueOnce(new Error(`Duplicate script ID '${LINKEDIN_SCRIPT_ID}'`));
    await expect(syncLinkedInCollector()).resolves.toBe("registered");
  });

  it("unregisters when switched off, and does nothing without the permission", async () => {
    stubChrome({ granted: true, enabled: false, registered: [LINKEDIN_SCRIPT_ID] });
    await expect(syncLinkedInCollector()).resolves.toBe("unregistered");
    stubChrome({ granted: false, enabled: true });
    await expect(syncLinkedInCollector()).resolves.toBe("unchanged");
  });
});
