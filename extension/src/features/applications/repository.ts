import type { Application, ApplicationStatus } from "@/types/application";
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

/** Every saved application, most recently updated first — the source list for a "jobs applied to" view. */
export async function getAllApplications(): Promise<Application[]> {
  const names = await drive.listApplicationFiles();
  const applications = await Promise.all(names.map((name) => drive.readJsonFile<Application>(name)));
  return applications
    .filter((app): app is Application => app !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Saves the current job + cover-letter draft to Drive (spec sections 6, 19)
 * — application data must live in the user's own `appDataFolder`, not stay
 * extension-local. Re-generating/editing the letter for the same job URL
 * updates the same record (keyed by `applicationIdForUrl`) instead of
 * creating a new one each time; `createdAt`/`status` carry over.
 */
export async function saveCoverLetterDraft(
  job: Job,
  coverLetter: string,
  translation?: { language: string; content: string } | null,
): Promise<void> {
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
    translation: translation ?? existing?.translation,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: existing?.status ?? "draft",
  };

  await drive.writeJsonFile(fileName(id), application);
}

export async function setApplicationStatus(id: string, status: ApplicationStatus): Promise<void> {
  const existing = await drive.readJsonFile<Application>(fileName(id));
  if (!existing) return;
  await drive.writeJsonFile(fileName(id), { ...existing, status, updatedAt: new Date().toISOString() });
}
