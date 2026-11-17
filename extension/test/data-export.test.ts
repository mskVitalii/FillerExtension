import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { Application } from "@/types/application";
import { EMPTY_JOB } from "@/types/job";

/**
 * "Export all data": the zip is a contract a separate local agent app
 * imports (docs/export-format.md) — these pin its layout and make sure no
 * secret ever lands in it.
 */

const driveStore = new Map<string, unknown>();
vi.mock("@/features/google-drive/client", () => ({
  readJsonFile: vi.fn(async (name: string) => {
    const value = driveStore.get(name);
    return value === undefined ? null : structuredClone(value);
  }),
  writeJsonFile: vi.fn(async (name: string, value: unknown) => {
    driveStore.set(name, structuredClone(value));
    return name;
  }),
  readTextFile: vi.fn(async (name: string) => (driveStore.get(name) as string | undefined) ?? null),
  writeTextFile: vi.fn(async (name: string, content: string) => {
    driveStore.set(name, content);
    return name;
  }),
  readBinaryFile: vi.fn(async (name: string) => (driveStore.get(name) as Blob | undefined) ?? null),
  writeBinaryFile: vi.fn(async (name: string, file: Blob) => {
    driveStore.set(name, file);
    return name;
  }),
  deleteFile: vi.fn(async (name: string) => {
    driveStore.delete(name);
  }),
  listApplicationFiles: vi.fn(async () => [...driveStore.keys()].filter((name) => name.startsWith("applications/"))),
}));
vi.mock("@/features/google-drive/auth", () => ({ isGoogleConnected: vi.fn(async () => true) }));

let local = new Map<string, unknown>();
let sync = new Map<string, unknown>();
function area(store: () => Map<string, unknown>) {
  return {
    get: async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.filter((k) => store().has(k)).map((k) => [k, structuredClone(store().get(k))]));
    },
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) store().set(k, structuredClone(v));
    },
    remove: async (key: string) => {
      store().delete(key);
    },
  };
}
vi.stubGlobal("chrome", {
  storage: { local: area(() => local), sync: area(() => sync) },
  runtime: { getManifest: () => ({ version: "9.9.9" }) },
});

const repo = await import("@/features/profile/repository");
const { buildExport, EXPORT_FORMAT, EXPORT_VERSION, exportFileName } = await import("@/features/export/data-export");

function file(content: string, name: string, type: string): File {
  return new File([content], name, { type });
}

async function unzip() {
  const result = await buildExport(new Date(2026, 10, 17, 12, 0, 0));
  const entries = unzipSync(result.zip);
  const json = (path: string) => JSON.parse(strFromU8(entries[path]));
  return { result, entries, json };
}

beforeEach(async () => {
  driveStore.clear();
  local = new Map();
  sync = new Map();
  local.set("openaiApiKey", "sk-SECRET-openai");
  local.set("tavilyApiKey", "tvly-SECRET");
  local.set("adzunaAppKey", "adzuna-SECRET");

  await repo.saveProfile({ ...(await repo.getProfile()), firstName: "Jane", lastName: "Doe", email: "jane@example.com" });
  await repo.saveCustomFields([{ id: "f1", label: "Visa", value: "Blue Card" }]);
  await repo.saveFaqAnswers([{ question: "Why us?", answer: "Because." }]);
  await repo.saveGenerationRules("Keep it short.", "x_gen_rules.md");
  await repo.saveOutreachRules("Ask for a call.");
  await repo.createLegend("Main", "I build backends.");
  const de = await repo.uploadCv(file("%PDF-de", "Lebenslauf.pdf", "application/pdf"), "Lebenslauf Text");
  await repo.updateCvSettings(de.id, { language: "de", rules: "Backend in Berlin" });
  const en = await repo.uploadCv(file("%PDF-en", "CV.pdf", "application/pdf"), "CV text");
  await repo.updateCvSettings(en.id, { language: "en", isDefaultForLanguage: true });

  const application: Application = {
    id: "app1",
    company: "Acme",
    position: "Backend Engineer",
    url: "https://acme.example/jobs/1",
    job: { ...EMPTY_JOB, company: "Acme", position: "Backend Engineer", url: "https://acme.example/jobs/1" },
    coverLetter: "Dear Acme,\n\nHire me.",
    translation: { language: "German", content: "Liebe Acme" },
    adaptedCv: {
      driveName: "adaptedCv/app1.pdf",
      fileName: "Jane Doe CV - Acme.pdf",
      cvId: de.id,
      cvFileName: "Lebenslauf.pdf",
      values: { city: "Berlin" },
      savedAt: "2026-11-17T10:00:00.000Z",
    },
    jobPosting: { driveName: "jobPosting/app1.md", fileName: "Job posting - Acme.md", savedAt: "2026-11-17T10:00:00.000Z" },
    createdAt: "2026-11-17T09:00:00.000Z",
    updatedAt: "2026-11-17T10:00:00.000Z",
    status: "applied",
  };
  driveStore.set("applications/app1.json", application);
  driveStore.set("adaptedCv/app1.pdf", new Blob(["%PDF-adapted"], { type: "application/pdf" }));
  driveStore.set("jobPosting/app1.md", "# Backend Engineer at Acme");
});

describe("buildExport", () => {
  it("writes a manifest that lists every file", async () => {
    const { result, entries, json } = await unzip();
    const manifest = json("manifest.json");
    expect(manifest).toMatchObject({ format: EXPORT_FORMAT, version: EXPORT_VERSION, extensionVersion: "9.9.9" });
    expect(manifest.counts).toEqual({ cvs: 2, legends: 1, applications: 1 });
    expect(manifest.warnings).toEqual([]);
    const listed = manifest.files.map((f: { path: string }) => f.path).sort();
    expect(listed).toEqual(Object.keys(entries).filter((p) => p !== "manifest.json").sort());
    for (const entry of manifest.files) expect(entry.bytes).toBe(entries[entry.path].byteLength);
    expect(result.fileName).toBe("filler-export-2026-11-17.zip");
    expect(exportFileName(new Date(2026, 0, 5))).toBe("filler-export-2026-01-05.zip");
  });

  it("includes profile, custom fields, FAQ, rules and legends", async () => {
    const { entries, json } = await unzip();
    expect(json("profile.json")).toMatchObject({ firstName: "Jane", email: "jane@example.com" });
    expect(json("custom-fields.json")).toEqual([{ id: "f1", label: "Visa", value: "Blue Card" }]);
    expect(json("faq.json")).toEqual([{ question: "Why us?", answer: "Because." }]);
    expect(strFromU8(entries["rules/cover-letter.md"])).toBe("Keep it short.");
    expect(strFromU8(entries["rules/outreach.md"])).toBe("Ask for a call.");
    expect(json("rules/index.json").coverLetter).toMatchObject({ file: "rules/cover-letter.md", sourceFileName: "x_gen_rules.md" });
    const legends = json("legends/index.json");
    expect(legends.items).toHaveLength(1);
    expect(strFromU8(entries[legends.items[0].file])).toBe("I build backends.");
  });

  it("includes every CV's original file and its language/default/rules", async () => {
    const { entries, json } = await unzip();
    const cvs = json("cvs/index.json");
    expect(cvs.items.map((cv: { fileName: string }) => cv.fileName)).toEqual(["Lebenslauf.pdf", "CV.pdf"]);
    const [de, en] = cvs.items;
    expect(de).toMatchObject({ format: "pdf", language: "de", isDefault: true, description: "Backend in Berlin", isActive: false });
    expect(en).toMatchObject({ language: "en", isDefault: true, isActive: true });
    expect(cvs.activeId).toBe(en.id);
    expect(strFromU8(entries[de.file])).toBe("%PDF-de");
    expect(strFromU8(entries[de.text])).toBe("Lebenslauf Text");
    expect(entries["cv-templates.json"]).toBeDefined();
  });

  it("includes each application with its posting, cover letter, translation and adapted CV", async () => {
    const { entries, json } = await unzip();
    const [app] = json("applications/index.json");
    expect(app).toMatchObject({ id: "app1", company: "Acme", status: "applied" });
    expect(json(app.files.application).url).toBe("https://acme.example/jobs/1");
    expect(strFromU8(entries[app.files.jobPosting])).toBe("# Backend Engineer at Acme");
    expect(strFromU8(entries[app.files.coverLetter])).toBe("Dear Acme,\n\nHire me.");
    expect(app.files.translations).toEqual([{ language: "German", path: "applications/app1/cover-letter.de.txt" }]);
    expect(strFromU8(entries[app.files.adaptedCv])).toBe("%PDF-adapted");
  });

  it("never includes an API key", async () => {
    const { entries } = await unzip();
    const everything = Object.values(entries).map((data) => strFromU8(data)).join("\n");
    expect(everything).not.toContain("SECRET");
    expect(everything).not.toContain("openaiApiKey");
  });

  it("goes on without a file Drive no longer has, and says so", async () => {
    driveStore.delete("adaptedCv/app1.pdf");
    const { json } = await unzip();
    const manifest = json("manifest.json");
    expect(manifest.warnings).toEqual([expect.stringContaining("adapted CV not found")]);
    expect(json("applications/index.json")[0].files.adaptedCv).toBeNull();
  });
});
