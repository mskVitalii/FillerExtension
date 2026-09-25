import type { CvTemplate, CvTemplateFormat, CvTemplateLibrary } from "@/types/cv-template";
import type { CvMeta } from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import * as drive from "@/features/google-drive/client";
import { isDocxFile } from "@/lib/cv-text";
import { isLatexFile } from "./latex";
import { normalizePlaceholders, syncVariables } from "./template";

export function isDocxCv(cv: Pick<CvMeta, "fileName" | "mimeType">): boolean {
  return isDocxFile({ name: cv.fileName, type: cv.mimeType });
}

export function isLatexCv(cv: Pick<CvMeta, "fileName" | "mimeType">): boolean {
  return isLatexFile({ name: cv.fileName, type: cv.mimeType });
}

export function cvFormat(cv: Pick<CvMeta, "fileName" | "mimeType">): CvTemplateFormat {
  if (isDocxCv(cv)) return "docx";
  if (isLatexCv(cv)) return "latex";
  return "pdf";
}

/** Same cache-then-Drive pattern as the profile repository: local cache first, Drive `cvTemplates.json` as source of truth. */
export async function getCvTemplates(): Promise<CvTemplateLibrary> {
  const cached = await getLocal("cvTemplatesCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<CvTemplateLibrary>("cvTemplates.json");
    if (remote) {
      await setLocal("cvTemplatesCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to no templates.
  }
  return {};
}

/**
 * The template for one CV: the CV's own text (a LaTeX CV's is its compiled
 * PDF's text), with the stored placeholder definitions reconciled against
 * the placeholders really in it — so a re-uploaded file's new placeholders
 * show up without re-saving.
 */
export function templateForCv(cv: CvMeta, library: CvTemplateLibrary): CvTemplate {
  const stored = library[cv.id];
  const content = normalizePlaceholders(cv.text);
  return {
    format: cvFormat(cv),
    content,
    variables: syncVariables(content, stored?.variables ?? []),
    updatedAt: stored?.updatedAt ?? "",
  };
}

/**
 * Writes the local cache first, so a Drive failure (not connected, expired
 * token) still keeps the edit on this device. `liveCvIds` prunes entries of
 * CVs deleted from the library since.
 */
export async function saveCvTemplate(
  cvId: string,
  template: Omit<CvTemplate, "updatedAt">,
  liveCvIds: string[],
): Promise<CvTemplate> {
  const saved: CvTemplate = { ...template, updatedAt: new Date().toISOString() };
  const library = await getCvTemplates();
  const next: CvTemplateLibrary = { [cvId]: saved };
  for (const id of liveCvIds) if (id !== cvId && library[id]) next[id] = library[id];
  await setLocal("cvTemplatesCache", next);
  await drive.writeJsonFile("cvTemplates.json", next);
  return saved;
}
