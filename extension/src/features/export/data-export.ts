import { strToU8, zipSync, type Zippable } from "fflate";
import type { Application } from "@/types/application";
import type { CvMeta } from "@/types/profile";
import * as drive from "@/features/google-drive/client";
import {
  getCustomFields,
  getCvFile,
  getCvLibrary,
  getFaqAnswers,
  getGenerationRules,
  getLanguageLevels,
  getLegendLibrary,
  getOutreachRules,
  getProfile,
} from "@/features/profile/repository";
import { getAdaptedCvFile, getAllApplications, getJobPostingFile } from "@/features/applications/repository";
import { cvFormat, getCvTemplates } from "@/features/cv-template/repository";
import { getUrlActivations } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { languageCode } from "@/lib/language-codes";
import { isLatexFile } from "@/features/cv-template/latex";

/**
 * "Export all data" (Settings): one zip with everything the extension knows
 * about the user — the contract a separate local agent app imports. The
 * layout is documented in `docs/export-format.md`; bump `EXPORT_VERSION`
 * on any change that isn't purely additive. Secrets (the OpenAI key, job
 * search API keys, Google tokens) are never read here.
 */

export const EXPORT_FORMAT = "filler-export";
export const EXPORT_VERSION = 1;

export interface ExportFileEntry {
  path: string;
  /** What the file is, so an importer can dispatch without parsing paths. */
  kind: ExportFileKind;
  contentType: string;
  bytes: number;
}

export type ExportFileKind =
  | "profile"
  | "custom-fields"
  | "language-levels"
  | "faq"
  | "preferences"
  | "rules-index"
  | "rules"
  | "legends-index"
  | "legend"
  | "cvs-index"
  | "cv-original"
  | "cv-compiled-pdf"
  | "cv-text"
  | "cv-templates"
  | "applications-index"
  | "application"
  | "job-posting"
  | "cover-letter"
  | "cover-letter-translation"
  | "adapted-cv"
  | "activation-log";

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** The extension version that wrote it (`chrome.runtime.getManifest().version`), when known. */
  extensionVersion: string | null;
  counts: { cvs: number; legends: number; applications: number };
  /** Things that couldn't be read (e.g. Google not connected, a file gone from Drive) — the export goes on without them. */
  warnings: string[];
  /** Every other file in the zip, `manifest.json` itself excluded. */
  files: ExportFileEntry[];
}

/** One CV as described in `cvs/index.json`. */
export interface ExportedCv {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  format: "pdf" | "docx" | "latex";
  /** ISO 639-1, e.g. "de"; null when untagged. */
  language: string | null;
  isDefault: boolean;
  /** The user's rules for which postings this CV is for. */
  description: string;
  isActive: boolean;
  uploadedAt: string;
  /** Paths inside the zip; null when the file couldn't be read. */
  file: string | null;
  compiledPdf: string | null;
  text: string;
}

export interface ExportedApplicationEntry {
  id: string;
  company: string;
  position: string;
  url: string;
  status: Application["status"];
  createdAt: string;
  updatedAt: string;
  /** Time-to-apply, when it was marked applied (`ApplicationTiming`). */
  timing: Application["timing"] | null;
  files: {
    application: string;
    jobPosting: string | null;
    coverLetter: string | null;
    translations: { language: string; path: string }[];
    adaptedCv: string | null;
  };
}

/** Characters a zip path segment shouldn't carry on Windows/macOS. */
export function safePathSegment(name: string): string {
  const printable = Array.from(name, (ch) => (ch.charCodeAt(0) < 32 ? "_" : ch)).join("");
  const cleaned = printable.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 120) || "file";
}

/** Runs `tasks` with at most `limit` in flight — thousands of applications mean thousands of Drive reads. */
async function inBatches<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length) await task(items[next++]);
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

function extensionVersion(): string | null {
  try {
    return typeof chrome !== "undefined" && chrome.runtime?.getManifest ? chrome.runtime.getManifest().version : null;
  } catch {
    return null;
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

class ZipBuilder {
  readonly entries: Zippable = {};
  readonly files: ExportFileEntry[] = [];

  add(path: string, kind: ExportFileKind, contentType: string, data: Uint8Array) {
    // PDFs/docx/zip are compressed already — store them as-is, deflate only text.
    const compressible = contentType.startsWith("text/") || contentType === "application/json";
    this.entries[path] = compressible ? data : [data, { level: 0 }];
    this.files.push({ path, kind, contentType, bytes: data.byteLength });
  }

  json(path: string, kind: ExportFileKind, value: unknown) {
    this.add(path, kind, "application/json", strToU8(JSON.stringify(value, null, 2)));
  }

  text(path: string, kind: ExportFileKind, content: string, contentType = "text/plain; charset=utf-8") {
    this.add(path, kind, contentType, strToU8(content));
  }

  async blob(path: string, kind: ExportFileKind, blob: Blob, contentType?: string) {
    this.add(path, kind, contentType || blob.type || "application/octet-stream", new Uint8Array(await blob.arrayBuffer()));
  }
}

export interface ExportResult {
  zip: Uint8Array;
  manifest: ExportManifest;
  fileName: string;
}

/** `filler-export-2026-11-17.zip` — the local date of the export. */
export function exportFileName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `filler-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

async function addCvs(zip: ZipBuilder, warnings: string[]): Promise<number> {
  const library = await getCvLibrary(true);
  const exported: ExportedCv[] = [];
  await inBatches(library.items, 4, async (cv: CvMeta) => {
    const dir = `cvs/${cv.id}`;
    let file: string | null = null;
    let compiledPdf: string | null = null;
    try {
      const original = await getCvFile(cv.id);
      if (original) {
        file = `${dir}/${safePathSegment(cv.fileName)}`;
        await zip.blob(file, "cv-original", original, cv.mimeType);
      } else warnings.push(`CV "${cv.fileName}": file not found in Google Drive.`);
    } catch (err) {
      warnings.push(`CV "${cv.fileName}": ${errorText(err)}`);
    }
    if (isLatexFile({ name: cv.fileName, type: cv.mimeType })) {
      try {
        const blob = await drive.readBinaryFile(`cv-${cv.id}.compiled.pdf`);
        if (blob) {
          compiledPdf = `${dir}/compiled.pdf`;
          await zip.blob(compiledPdf, "cv-compiled-pdf", blob, "application/pdf");
        }
      } catch (err) {
        warnings.push(`CV "${cv.fileName}" compiled PDF: ${errorText(err)}`);
      }
    }
    const text = `${dir}/text.txt`;
    zip.text(text, "cv-text", cv.text);
    exported.push({
      id: cv.id,
      name: cv.name?.trim() || cv.fileName,
      fileName: cv.fileName,
      mimeType: cv.mimeType,
      format: cvFormat(cv),
      language: cv.language ?? null,
      isDefault: Boolean(cv.isDefaultForLanguage),
      description: cv.rules ?? "",
      isActive: cv.id === library.activeId,
      uploadedAt: cv.uploadedAt,
      file,
      compiledPdf,
      text,
    });
  });
  const order = new Map(library.items.map((cv, i) => [cv.id, i]));
  exported.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  zip.json("cvs/index.json", "cvs-index", { activeId: library.activeId, items: exported });
  zip.json("cv-templates.json", "cv-templates", await getCvTemplates());
  return exported.length;
}

async function addLegends(zip: ZipBuilder): Promise<number> {
  const library = await getLegendLibrary(true);
  const items = library.items.map((legend) => {
    const file = `legends/${legend.id}.md`;
    zip.text(file, "legend", legend.content, "text/markdown; charset=utf-8");
    return { id: legend.id, name: legend.name, uploadedAt: legend.uploadedAt, isActive: legend.id === library.activeId, file };
  });
  zip.json("legends/index.json", "legends-index", { activeId: library.activeId, items });
  return items.length;
}

async function addRules(zip: ZipBuilder) {
  const [coverLetter, outreach] = await Promise.all([getGenerationRules(), getOutreachRules()]);
  const index: Record<string, { file: string; sourceFileName: string | null; updatedAt: string } | null> = {
    coverLetter: null,
    outreach: null,
  };
  if (coverLetter) {
    zip.text("rules/cover-letter.md", "rules", coverLetter.content, "text/markdown; charset=utf-8");
    index.coverLetter = { file: "rules/cover-letter.md", sourceFileName: coverLetter.sourceFileName ?? null, updatedAt: coverLetter.updatedAt };
  }
  if (outreach) {
    zip.text("rules/outreach.md", "rules", outreach.content, "text/markdown; charset=utf-8");
    index.outreach = { file: "rules/outreach.md", sourceFileName: outreach.sourceFileName ?? null, updatedAt: outreach.updatedAt };
  }
  zip.json("rules/index.json", "rules-index", index);
}

async function addApplications(zip: ZipBuilder, warnings: string[]): Promise<number> {
  let applications: Application[];
  try {
    applications = await getAllApplications();
  } catch (err) {
    warnings.push(`Applications: ${errorText(err)}`);
    applications = [];
  }
  const index: ExportedApplicationEntry[] = [];
  await inBatches(applications, 6, async (app) => {
    const dir = `applications/${app.id}`;
    const files: ExportedApplicationEntry["files"] = {
      application: `${dir}/application.json`,
      jobPosting: null,
      coverLetter: null,
      translations: [],
      adaptedCv: null,
    };
    zip.json(files.application, "application", app);
    try {
      const posting = await getJobPostingFile(app);
      files.jobPosting = `${dir}/job-posting.md`;
      await zip.blob(files.jobPosting, "job-posting", posting, "text/markdown; charset=utf-8");
    } catch (err) {
      warnings.push(`Application ${app.id} job posting: ${errorText(err)}`);
    }
    if (app.coverLetter) {
      files.coverLetter = `${dir}/cover-letter.txt`;
      zip.text(files.coverLetter, "cover-letter", app.coverLetter);
    }
    if (app.translation?.content) {
      const code = languageCode(app.translation.language) ?? safePathSegment(app.translation.language.toLowerCase());
      const path = `${dir}/cover-letter.${code}.txt`;
      zip.text(path, "cover-letter-translation", app.translation.content);
      files.translations.push({ language: app.translation.language, path });
    }
    if (app.adaptedCv) {
      try {
        const pdf = await getAdaptedCvFile(app.adaptedCv);
        if (pdf) {
          files.adaptedCv = `${dir}/adapted-cv.pdf`;
          await zip.blob(files.adaptedCv, "adapted-cv", pdf, "application/pdf");
        } else warnings.push(`Application ${app.id}: adapted CV not found in Google Drive.`);
      } catch (err) {
        warnings.push(`Application ${app.id} adapted CV: ${errorText(err)}`);
      }
    }
    index.push({
      id: app.id,
      company: app.company,
      position: app.position,
      url: app.url,
      status: app.status,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
      timing: app.timing ?? null,
      files,
    });
  });
  index.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  zip.json("applications/index.json", "applications-index", index);
  return index.length;
}

/** Collects every document and file into one zip. Never throws for a single unreadable item — see `manifest.warnings`. */
export async function buildExport(now = new Date()): Promise<ExportResult> {
  const zip = new ZipBuilder();
  const warnings: string[] = [];

  const [profile, customFields, languageLevels, faq, preferences, activations] = await Promise.all([
    getProfile(),
    getCustomFields(),
    getLanguageLevels(),
    getFaqAnswers(),
    getPreferences(),
    getUrlActivations(),
  ]);
  zip.json("profile.json", "profile", profile);
  zip.json("custom-fields.json", "custom-fields", customFields);
  zip.json("language-levels.json", "language-levels", languageLevels);
  zip.json("faq.json", "faq", faq);
  zip.json("preferences.json", "preferences", preferences);
  zip.json("activation-log.json", "activation-log", activations);
  await addRules(zip);
  const legends = await addLegends(zip).catch((err) => {
    warnings.push(`Personal Legends: ${errorText(err)}`);
    return 0;
  });
  const cvs = await addCvs(zip, warnings).catch((err) => {
    warnings.push(`CVs: ${errorText(err)}`);
    return 0;
  });
  const applications = await addApplications(zip, warnings);

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    extensionVersion: extensionVersion(),
    counts: { cvs, legends, applications },
    warnings,
    files: [...zip.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
  const entries: Zippable = { "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), ...zip.entries };
  const zipped = zipSync(entries, { level: 6, mtime: now });
  return { zip: zipped, manifest, fileName: exportFileName(now) };
}
