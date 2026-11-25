import { EMPTY_JOB, type Job } from "@/types/job";
import { applyViaAgent, getAgentSettings, hasAgentPermission } from "@/features/agent-bridge/client";
import { syncWithAgent } from "@/features/agent-bridge/sync";
import { addCollectedLinkedInJobs, sanitizeIncoming } from "./store";
import { cleanEmployerUrl } from "./apply-link";

/**
 * The on-page "Apply via Filler AI" button next to LinkedIn's "Apply ↗" (background side): keeps
 * the job in Filler's LinkedIn list and queues it in the local agent with the employer's own URL —
 * the `url` behind LinkedIn's redirect, re-validated here. The agent opens that page directly and
 * never LinkedIn (`applyViaAgent` refuses any LinkedIn URL besides).
 */

/** The agent applies with the user's data as it is now; a slow sync must not hold the click for long. */
const SYNC_WAIT_MS = 30_000;

export interface AgentHandoffResult {
  ok: boolean;
  message: string;
}

export async function handOffLinkedInJobToAgent(raw: { job: unknown; applyUrl: unknown; description: unknown }): Promise<AgentHandoffResult> {
  const [job] = sanitizeIncoming([raw.job]);
  if (!job) return { ok: false, message: "Couldn't read this job's id." };
  const applyUrl = cleanEmployerUrl(typeof raw.applyUrl === "string" ? raw.applyUrl : "");
  if (!applyUrl) return { ok: false, message: "This job has no employer link (Easy Apply) — Filler doesn't apply on LinkedIn." };
  await addCollectedLinkedInJobs([job]);

  const settings = await getAgentSettings();
  if (!settings || !(await hasAgentPermission())) {
    return { ok: false, message: "Saved to Filler. Connect the local agent first (Filler panel → \"Connect local AI agent\")." };
  }
  await Promise.race([syncWithAgent(settings).catch(() => undefined), new Promise((resolve) => setTimeout(resolve, SYNC_WAIT_MS))]);
  const posting: Job = {
    ...EMPTY_JOB,
    position: job.title,
    company: job.company,
    location: job.location,
    description: typeof raw.description === "string" ? raw.description.slice(0, 8000) : "",
    url: applyUrl,
  };
  try {
    const created = await applyViaAgent(settings, applyUrl, posting);
    return { ok: true, message: `Queued in the agent (${created.status}) — applying on ${new URL(applyUrl).hostname}.` };
  } catch (err) {
    const message = (err as Error).message;
    return { ok: false, message: /fetch|network|abort|timed? ?out/i.test(message) ? "The local agent isn't answering — is FillerAgent running?" : message };
  }
}
