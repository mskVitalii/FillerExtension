import type { Application } from "@/types/application";
import type { Job } from "@/types/job";
import * as drive from "@/features/google-drive/client";
import { applicationIdForUrl } from "./id";

function fileName(id: string): string {
  return `applications/${id}.json`;
}

export async function getApplicationByUrl(url: string): Promise<Application | null> {
  if (!url) return null;
  const id = await applicationIdForUrl(url);
  return drive.readJsonFile<Application>(fileName(id));
}

/**
 * Saves the current job + cover-letter draft to Drive (spec sections 6, 19)
 * — application data must live in the user's own `appDataFolder`, not stay
 * extension-local. Re-generating/editing the letter for the same job URL
 * updates the same record (keyed by `applicationIdForUrl`) instead of
 * creating a new one each time; `createdAt`/`status` carry over.
 */
export async function saveCoverLetterDraft(job: Job, coverLetter: string): Promise<void> {
  if (!job.url || !coverLetter) return;

  const id = await applicationIdForUrl(job.url);
  const existing = await drive.readJsonFile<Application>(fileName(id));
  const now = new Date().toISOString();

  const application: Application = {
    id,
    company: job.company,
    position: job.position,
    url: job.url,
    job,
    coverLetter,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: existing?.status ?? "draft",
  };

  await drive.writeJsonFile(fileName(id), application);
}
