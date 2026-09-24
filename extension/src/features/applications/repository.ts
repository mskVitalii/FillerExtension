import type { AdaptedCvRecord, Application, ApplicationStatus } from "@/types/application";
import type { Job } from "@/types/job";
import * as drive from "@/features/google-drive/client";
import { applicationIdForUrl } from "./id";

function fileName(id: string): string {
  return `applications/${id}.json`;
}

/** Deliberately *not* under `applications/` — `listApplicationFiles` treats every name containing that as a record. */
function adaptedCvDriveName(id: string): string {
  return `adaptedCv/${id}.pdf`;
}

/**
 * Serializes read-modify-write updates per application within this page:
 * the cover-letter autosave and an adapted-CV save can land on the same
 * record at the same moment, and without this the second write would drop
 * the first one's field.
 */
const pendingWrites = new Map<string, Promise<unknown>>();

function updateApplication<T>(id: string, update: () => Promise<T>): Promise<T> {
  const previous = pendingWrites.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(update);
  pendingWrites.set(id, next);
  void next.finally(() => {
    if (pendingWrites.get(id) === next) pendingWrites.delete(id);
  });
  return next;
}

/** A fresh record for `job`, or `existing` with the job details refreshed — every other field carries over. */
function baseRecord(id: string, job: Job, existing: Application | null, now: string): Application {
  return {
    coverLetter: "",
    createdAt: now,
    status: "draft",
    ...existing,
    id,
    company: job.company,
    position: job.position,
    url: job.url,
    job,
    updatedAt: now,
  };
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
 * creating a new one each time; `createdAt`/`status`/`adaptedCv` carry over.
 */
export async function saveCoverLetterDraft(
  job: Job,
  coverLetter: string,
  translation?: { language: string; content: string } | null,
): Promise<void> {
  if (!job.url || !coverLetter) return;
  const id = await applicationIdForUrl(job.url);
  await updateApplication(id, async () => {
    const existing = await drive.readJsonFile<Application>(fileName(id));
    const application: Application = {
      ...baseRecord(id, job, existing, new Date().toISOString()),
      coverLetter,
      translation: translation ?? existing?.translation,
    };
    await drive.writeJsonFile(fileName(id), application);
  });
}

/**
 * Keeps the adapted CV sent for this posting next to its application —
 * creating the record if no cover letter was saved yet. One PDF per
 * posting: a newer adaptation replaces the previous one.
 */
export async function saveAdaptedCv(
  job: Job,
  pdf: File,
  source: Pick<AdaptedCvRecord, "cvId" | "cvFileName" | "values">,
): Promise<AdaptedCvRecord | null> {
  if (!job.url) return null;
  const id = await applicationIdForUrl(job.url);
  return updateApplication(id, async () => {
    const driveName = adaptedCvDriveName(id);
    await drive.writeBinaryFile(driveName, pdf);
    const now = new Date().toISOString();
    const record: AdaptedCvRecord = { driveName, fileName: pdf.name, ...source, savedAt: now };
    const existing = await drive.readJsonFile<Application>(fileName(id));
    await drive.writeJsonFile(fileName(id), { ...baseRecord(id, job, existing, now), adaptedCv: record });
    return record;
  });
}

export async function getAdaptedCvFile(record: AdaptedCvRecord): Promise<File | null> {
  const blob = await drive.readBinaryFile(record.driveName);
  return blob ? new File([blob], record.fileName, { type: "application/pdf" }) : null;
}

export async function setApplicationStatus(id: string, status: ApplicationStatus): Promise<void> {
  await updateApplication(id, async () => {
    const existing = await drive.readJsonFile<Application>(fileName(id));
    if (!existing) return;
    await drive.writeJsonFile(fileName(id), { ...existing, status, updatedAt: new Date().toISOString() });
  });
}

/** Removes a saved application record from Drive — the "delete" action on an Applications list row — along with its adapted CV. */
export async function deleteApplication(id: string): Promise<void> {
  await updateApplication(id, async () => {
    await drive.deleteFile(adaptedCvDriveName(id)).catch(() => undefined);
    await drive.deleteFile(fileName(id));
  });
}
