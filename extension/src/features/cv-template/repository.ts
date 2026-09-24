import { EMPTY_CV_TEMPLATE, type CvTemplate, type CvTemplateLibrary } from "@/types/cv-template";
import type { CvMeta } from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import * as drive from "@/features/google-drive/client";
import { isDocxFile } from "@/lib/cv-text";
import { syncVariables } from "./template";

export function isDocxCv(cv: Pick<CvMeta, "fileName" | "mimeType">): boolean {
  return isDocxFile({ name: cv.fileName, type: cv.mimeType });
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
 * The template for one CV. A Word CV is always a `docx` template whose text
 * is the file's current text (so a re-uploaded file's new placeholders show
 * up without re-saving); a PDF CV gets a Markdown template, empty until the
 * user builds one.
 */
export function templateForCv(cv: CvMeta, library: CvTemplateLibrary): CvTemplate {
  const stored = library[cv.id];
  if (isDocxCv(cv)) {
    const variables = stored?.variables ?? [];
    return { format: "docx", content: cv.text, variables: syncVariables(cv.text, variables), updatedAt: stored?.updatedAt ?? "" };
  }
  return stored && stored.format === "markdown" ? stored : EMPTY_CV_TEMPLATE;
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
