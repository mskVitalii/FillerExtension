import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyViaAgent: vi.fn(),
  getAgentSettings: vi.fn(),
  hasAgentPermission: vi.fn(),
  syncWithAgent: vi.fn(),
  addCollectedLinkedInJobs: vi.fn(),
}));

vi.mock("@/features/agent-bridge/client", () => ({
  applyViaAgent: mocks.applyViaAgent,
  getAgentSettings: mocks.getAgentSettings,
  hasAgentPermission: mocks.hasAgentPermission,
}));
vi.mock("@/features/agent-bridge/sync", () => ({ syncWithAgent: mocks.syncWithAgent }));
vi.mock("@/features/linkedin-collector/store", async (original) => ({
  ...(await original<typeof import("@/features/linkedin-collector/store")>()),
  addCollectedLinkedInJobs: mocks.addCollectedLinkedInJobs,
}));

import { handOffLinkedInJobToAgent } from "@/features/linkedin-collector/agent-handoff";

const job = { id: "4100000003", url: "https://www.linkedin.com/jobs/view/4100000003/", title: "Senior Go Engineer", company: "Acme Robotics", location: "Munich" };
const applyUrl = "https://jobs.ashbyhq.com/acme-robotics/1?utm_source=x&Inbound=LinkedIn";

describe("Apply via Filler AI (background)", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getAgentSettings.mockResolvedValue({ port: 1, token: "t" });
    mocks.hasAgentPermission.mockResolvedValue(true);
    mocks.syncWithAgent.mockResolvedValue(undefined);
    mocks.addCollectedLinkedInJobs.mockResolvedValue({ added: 1, total: 1, ids: [job.id] });
    mocks.applyViaAgent.mockResolvedValue({ status: "queued" });
  });

  it("keeps the job and queues the employer's own link, never LinkedIn's", async () => {
    const result = await handOffLinkedInJobToAgent({ job, applyUrl, description: "We build robots." });
    expect(result).toEqual({ ok: true, message: "Queued in the agent (queued) — applying on jobs.ashbyhq.com." });
    expect(mocks.addCollectedLinkedInJobs).toHaveBeenCalledWith([job]);
    expect(mocks.syncWithAgent).toHaveBeenCalled();
    const [, url, posting] = mocks.applyViaAgent.mock.calls[0];
    expect(url).toBe("https://jobs.ashbyhq.com/acme-robotics/1?Inbound=LinkedIn");
    expect(posting).toMatchObject({ position: "Senior Go Engineer", company: "Acme Robotics", url, description: "We build robots." });
  });

  it("refuses a LinkedIn or non-web apply link before saving anything", async () => {
    for (const bad of ["https://www.linkedin.com/jobs/view/4100000003/apply/", "javascript:alert(1)", ""]) {
      const result = await handOffLinkedInJobToAgent({ job, applyUrl: bad, description: "" });
      expect(result.ok).toBe(false);
    }
    expect(mocks.addCollectedLinkedInJobs).not.toHaveBeenCalled();
    expect(mocks.applyViaAgent).not.toHaveBeenCalled();
  });

  it("saves the job and says to connect the agent when it isn't", async () => {
    mocks.getAgentSettings.mockResolvedValue(null);
    const result = await handOffLinkedInJobToAgent({ job, applyUrl, description: "" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Connect the local agent/);
    expect(mocks.addCollectedLinkedInJobs).toHaveBeenCalled();
    expect(mocks.applyViaAgent).not.toHaveBeenCalled();
  });

  it("says the agent isn't running when it can't be reached", async () => {
    mocks.applyViaAgent.mockRejectedValue(new TypeError("Failed to fetch"));
    const result = await handOffLinkedInJobToAgent({ job, applyUrl, description: "" });
    expect(result).toEqual({ ok: false, message: "The local agent isn't answering — is FillerAgent running?" });
  });
});
