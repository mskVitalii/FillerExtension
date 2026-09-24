import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_JOB, type Job } from "@/types/job";
import type { Application } from "@/types/application";
import type { CvMeta } from "@/types/profile";

/** In-memory stand-in for the Drive appDataFolder, with an artificial delay so interleaved writes actually interleave. */
const store = new Map<string, unknown>();
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
vi.mock("@/features/google-drive/client", () => ({
  readJsonFile: vi.fn(async (name: string) => {
    await tick();
    return (store.get(name) as unknown) ?? null;
  }),
  writeJsonFile: vi.fn(async (name: string, value: unknown) => {
    await tick();
    store.set(name, structuredClone(value));
    return name;
  }),
  writeBinaryFile: vi.fn(async (name: string, file: File) => {
    store.set(name, file);
    return name;
  }),
  readBinaryFile: vi.fn(async (name: string) => (store.get(name) as Blob | undefined) ?? null),
  deleteFile: vi.fn(async (name: string) => {
    store.delete(name);
  }),
  listApplicationFiles: vi.fn(async () => [...store.keys()].filter((name) => name.includes("applications/"))),
}));

const repo = await import("@/features/applications/repository");
const { recordAdaptedCv } = await import("@/features/cv-template/adapt");
const drive = await import("@/features/google-drive/client");

const job: Job = { ...EMPTY_JOB, url: "https://jobs.example/123", position: "Backend Engineer", company: "Acme" };
const pdf = () => new File(["%PDF-1.7"], "Jane Doe CV.pdf", { type: "application/pdf" });
const source = { cvId: "cv1", cvFileName: "Jane CV.docx", values: { city: "Berlin", main_language: "Go" } };

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("adapted CV in applications", () => {
  it("creates the application when no cover letter was saved yet, and keeps the PDF next to it", async () => {
    await repo.saveAdaptedCv(job, pdf(), source);
    const [app] = await repo.getAllApplications();
    expect(app).toMatchObject({ position: "Backend Engineer", coverLetter: "", status: "draft" });
    expect(app.adaptedCv).toMatchObject({ fileName: "Jane Doe CV.pdf", cvFileName: "Jane CV.docx", values: source.values });
    const file = await repo.getAdaptedCvFile(app.adaptedCv!);
    expect(await file!.text()).toBe("%PDF-1.7");
    // The PDF lives outside `applications/`, so the list never mistakes it for a record.
    expect(await drive.listApplicationFiles()).toEqual([expect.stringMatching(/^applications\/.+\.json$/)]);
  });

  it("a later cover-letter save keeps the adapted CV, even when both land at once", async () => {
    await Promise.all([repo.saveAdaptedCv(job, pdf(), source), repo.saveCoverLetterDraft(job, "Dear Acme,")]);
    const app = (await repo.getApplicationByUrl(job.url)) as Application;
    expect(app.coverLetter).toBe("Dear Acme,");
    expect(app.adaptedCv?.values).toEqual(source.values);
  });

  it("deleting the application deletes its adapted CV too", async () => {
    const record = await repo.saveAdaptedCv(job, pdf(), source);
    const app = (await repo.getApplicationByUrl(job.url)) as Application;
    await repo.deleteApplication(app.id);
    expect(store.has(record!.driveName)).toBe(false);
    expect(await repo.getAllApplications()).toEqual([]);
  });

  it("recordAdaptedCv skips an unchanged re-save and pages without a recognized posting", async () => {
    const cv = { id: "cv1", fileName: "Jane CV.docx", uploadedAt: "t" } as CvMeta;
    expect(await recordAdaptedCv(job, cv, source.values, pdf())).toBe(true);
    expect(await recordAdaptedCv(job, cv, source.values, pdf())).toBe(false);
    expect(await recordAdaptedCv(job, cv, { ...source.values, city: "Munich" }, pdf())).toBe(true);
    expect(await recordAdaptedCv({ ...EMPTY_JOB, url: "https://news.example" }, cv, source.values, pdf())).toBe(false);
    expect(drive.writeBinaryFile).toHaveBeenCalledTimes(2);
  });
});
