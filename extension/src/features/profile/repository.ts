import {
  EMPTY_PROFILE,
  type CustomField,
  type CvLibrary,
  type CvMeta,
  type FaqEntry,
  type GenerationRules,
  type LanguageLevel,
  type LegendLibrary,
  type LegendMeta,
  type OutreachRules,
  type PersonalLegend,
  type Profile,
} from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import { readCachedJson, readCachedText, writeCachedJson, writeCachedText } from "@/features/storage/drive-cache";
import * as drive from "@/features/google-drive/client";
import { extractPdfText } from "@/lib/pdf-text";
import { isLatexFile } from "@/features/cv-template/latex";

/**
 * Profile/CV/Personal Legend live in Google Drive appDataFolder (source of
 * truth) with a local cache for instant reads by Side Panel and Content
 * Script (spec sections 7-9, 20).
 */
export async function getProfile(): Promise<Profile> {
  // Merge over EMPTY_PROFILE so a profile saved before a new field existed
  // (e.g. `pronouns`) still comes back with every key defined.
  const cached = await getLocal("profileCache");
  if (cached) return { ...EMPTY_PROFILE, ...cached };
  try {
    const remote = await drive.readJsonFile<Profile>("profile.json");
    if (remote) {
      const merged = { ...EMPTY_PROFILE, ...remote };
      await setLocal("profileCache", merged);
      return merged;
    }
  } catch {
    // Google not connected yet — fall through to empty profile.
  }
  return EMPTY_PROFILE;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await setLocal("profileCache", profile);
  await drive.writeJsonFile("profile.json", profile);
}

/** `${legendFileName(id)}` names each library entry's Drive text file uniquely — the legacy single-legend extension only ever wrote "legend.md". */
function legendFileName(id: string): string {
  return `legend-${id}.md`;
}

async function saveLegendLibrary(library: LegendLibrary): Promise<void> {
  await writeCachedJson("legendLibraryCache", "legendLibrary.json", library);
}

/**
 * One-time upgrade from the pre-multi-legend format (a single `legendCache`
 * + Drive `legend.md`) into a library of one entry, mirroring
 * `migrateLegacyCv` — a user who already had a Personal Legend written
 * doesn't lose it when this ships.
 */
async function migrateLegacyLegend(): Promise<LegendLibrary> {
  const cached = await getLocal("legendCache");
  let content = cached?.content;
  const uploadedAt = cached?.updatedAt ?? new Date().toISOString();
  if (!content) {
    try {
      const remote = await drive.readTextFile("legend.md");
      if (remote !== null) content = remote;
    } catch {
      // Google not connected yet.
    }
  }
  if (!content) return { items: [], activeId: null };
  const id = crypto.randomUUID();
  const meta: LegendMeta = { id, name: "Personal Legend", content, uploadedAt };
  await drive.writeTextFile(legendFileName(id), content);
  return { items: [meta], activeId: id };
}

export async function getLegendLibrary(): Promise<LegendLibrary> {
  const stored = await readCachedJson("legendLibraryCache", "legendLibrary.json");
  if (stored) return stored;
  // Not stored yet (or Google not connected) — fall through to the legacy migration/empty library.
  const migrated = await migrateLegacyLegend();
  await saveLegendLibrary(migrated);
  return migrated;
}

/** The legend generation currently treats as "the" Personal Legend — kept as the same `PersonalLegend` shape every existing caller already expects. */
export async function getPersonalLegend(): Promise<PersonalLegend | null> {
  const library = await getLegendLibrary();
  const active = library.items.find((legend) => legend.id === library.activeId);
  if (!active) return null;
  return { content: active.content, updatedAt: active.uploadedAt };
}

export async function createLegend(name: string, content: string): Promise<LegendMeta> {
  const id = crypto.randomUUID();
  const meta: LegendMeta = { id, name, content, uploadedAt: new Date().toISOString() };
  await drive.writeTextFile(legendFileName(id), content);
  const library = await getLegendLibrary();
  const next: LegendLibrary = { items: [...library.items, meta], activeId: id };
  await saveLegendLibrary(next);
  return meta;
}

/** `.txt`/`.md` are read as plain text; `.pdf` is parsed via the same `extractPdfText` used for CVs. */
export async function uploadLegendFile(file: File): Promise<LegendMeta> {
  const content =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
      ? await extractPdfText(file)
      : await file.text();
  return createLegend(file.name, content);
}

/** Switches which legend generation uses — returns the newly active entry, or null if `id` isn't in the library. */
export async function setActiveLegend(id: string): Promise<LegendMeta | null> {
  const library = await getLegendLibrary();
  const meta = library.items.find((legend) => legend.id === id);
  if (!meta) return null;
  await saveLegendLibrary({ ...library, activeId: id });
  return meta;
}

export async function updateLegendContent(id: string, content: string): Promise<void> {
  const library = await getLegendLibrary();
  const meta = library.items.find((legend) => legend.id === id);
  if (!meta) return;
  await drive.writeTextFile(legendFileName(id), content);
  const items = library.items.map((legend) => (legend.id === id ? { ...legend, content } : legend));
  await saveLegendLibrary({ ...library, items });
}

/** Removes one legend from the library. If it was active, the next remaining entry (if any) becomes active. */
export async function deleteLegend(id: string): Promise<void> {
  const library = await getLegendLibrary();
  const meta = library.items.find((legend) => legend.id === id);
  if (!meta) return;
  await drive.deleteFile(legendFileName(id));
  const items = library.items.filter((legend) => legend.id !== id);
  const activeId = library.activeId === id ? (items[0]?.id ?? null) : library.activeId;
  await saveLegendLibrary({ items, activeId });
}

/** `${cvFileName(id)}` names each library entry's Drive PDF uniquely — the legacy single-CV extension only ever wrote "cv.pdf". */
function cvFileName(id: string): string {
  return `cv-${id}.pdf`;
}

/** A LaTeX CV's compiled PDF, kept next to its sources for the plain "Attach CV". */
function compiledCvFileName(id: string): string {
  return `cv-${id}.compiled.pdf`;
}

async function writeCompiledCv(id: string, pdf: File | null | undefined): Promise<void> {
  if (pdf) await drive.writeBinaryFile(compiledCvFileName(id), pdf);
}

async function saveCvLibrary(library: CvLibrary): Promise<void> {
  await writeCachedJson("cvLibraryCache", "cvLibrary.json", library);
}

/**
 * One-time upgrade from the pre-multi-CV format (a single `cvMetaCache` +
 * Drive `cv.pdf`) into a library of one entry, so a user who already had a
 * CV uploaded doesn't lose it when this ships. Runs at most once: the first
 * call that finds no library persists one going forward (even an empty
 * one), so later calls skip straight to reading it.
 */
async function migrateLegacyCv(): Promise<CvLibrary> {
  const legacyMeta = await getLocal("cvMetaCache");
  if (!legacyMeta) return { items: [], activeId: null };
  const id = crypto.randomUUID();
  const meta: CvMeta = { ...legacyMeta, id };
  try {
    const blob = await drive.readBinaryFile("cv.pdf");
    if (blob) {
      await drive.writeBinaryFile(cvFileName(id), new File([blob], meta.fileName, { type: meta.mimeType }));
    }
  } catch {
    // Google not connected yet — the metadata still migrates; the file copies over next time Drive is reachable.
  }
  return { items: [meta], activeId: id };
}

export async function getCvLibrary(): Promise<CvLibrary> {
  const stored = await readCachedJson("cvLibraryCache", "cvLibrary.json");
  if (stored) return stored;
  // Not stored yet (or Google not connected) — fall through to the legacy migration/empty library.
  const migrated = await migrateLegacyCv();
  await saveCvLibrary(migrated);
  return migrated;
}

/** The CV autofill/AI/context-menu treat as "the" CV — the library's active entry. */
export async function getCvMeta(): Promise<CvMeta | null> {
  const library = await getCvLibrary();
  return library.items.find((cv) => cv.id === library.activeId) ?? null;
}

/** `compiledPdf` — for a LaTeX CV, its compiled PDF (see `prepareCvFile`). */
export async function uploadCv(file: File, extractedText: string, compiledPdf?: File | null): Promise<CvMeta> {
  const id = crypto.randomUUID();
  const driveFileId = await drive.writeBinaryFile(cvFileName(id), file);
  await writeCompiledCv(id, compiledPdf);
  const meta: CvMeta = {
    id,
    fileName: file.name,
    mimeType: file.type,
    driveFileId,
    text: extractedText,
    uploadedAt: new Date().toISOString(),
  };
  const library = await getCvLibrary();
  const next: CvLibrary = { items: [...library.items, meta], activeId: id };
  await saveCvLibrary(next);
  return meta;
}

/** Switches which uploaded CV autofill/AI use — returns the newly active entry, or null if `id` isn't in the library. */
export async function setActiveCv(id: string): Promise<CvMeta | null> {
  const library = await getCvLibrary();
  const meta = library.items.find((cv) => cv.id === id);
  if (!meta) return null;
  await saveCvLibrary({ ...library, activeId: id });
  return meta;
}

/** Defaults to the active CV; pass `id` to fetch a specific library entry's file instead. */
export async function getCvFile(id?: string): Promise<File | null> {
  const library = await getCvLibrary();
  const targetId = id ?? library.activeId;
  const meta = library.items.find((cv) => cv.id === targetId);
  if (!meta) return null;
  const blob = await drive.readBinaryFile(cvFileName(meta.id));
  if (!blob) return null;
  return new File([blob], meta.fileName, { type: meta.mimeType });
}

/**
 * The file to put into a job form's CV upload: the CV itself, except for a
 * LaTeX CV, whose sources are no use there — its compiled PDF instead.
 */
export async function getCvAttachmentFile(id?: string): Promise<File | null> {
  const library = await getCvLibrary();
  const targetId = id ?? library.activeId;
  const meta = library.items.find((cv) => cv.id === targetId);
  if (!meta) return null;
  if (!isLatexFile({ name: meta.fileName, type: meta.mimeType })) return getCvFile(meta.id);
  const blob = await drive.readBinaryFile(compiledCvFileName(meta.id));
  if (!blob) return null;
  return new File([blob], `${meta.fileName.replace(/\.(zip|tex)$/i, "")}.pdf`, { type: "application/pdf" });
}

/**
 * Swaps the file behind an existing library entry, keeping its id — used by
 * the Adapt CV tab when a Word CV was edited (e.g. a new `{{placeholder}}`
 * typed in) so its placeholder definitions, keyed by that id, stay attached.
 */
export async function replaceCvFile(id: string, file: File, extractedText: string, compiledPdf?: File | null): Promise<CvMeta | null> {
  const library = await getCvLibrary();
  const meta = library.items.find((cv) => cv.id === id);
  if (!meta) return null;
  const driveFileId = await drive.writeBinaryFile(cvFileName(id), file);
  await writeCompiledCv(id, compiledPdf);
  const next: CvMeta = {
    ...meta,
    fileName: file.name,
    mimeType: file.type,
    driveFileId,
    text: extractedText,
    uploadedAt: new Date().toISOString(),
  };
  await saveCvLibrary({ ...library, items: library.items.map((cv) => (cv.id === id ? next : cv)) });
  return next;
}

/** Removes one CV from the library. If it was active, the next remaining entry (if any) becomes active. */
export async function deleteCv(id: string): Promise<void> {
  const library = await getCvLibrary();
  const meta = library.items.find((cv) => cv.id === id);
  if (!meta) return;
  await drive.deleteFile(cvFileName(meta.id));
  if (isLatexFile({ name: meta.fileName, type: meta.mimeType })) await drive.deleteFile(compiledCvFileName(meta.id)).catch(() => undefined);
  const items = library.items.filter((cv) => cv.id !== id);
  const activeId = library.activeId === id ? (items[0]?.id ?? null) : library.activeId;
  await saveCvLibrary({ items, activeId });
}

/**
 * Custom fields (spec_2 item 1) — same cache-then-Drive pattern as Profile,
 * but stored separately since they're drag-only and never fed into autofill.
 */
export async function getCustomFields(): Promise<CustomField[]> {
  return (await readCachedJson("customFieldsCache", "customFields.json")) ?? [];
}

export async function saveCustomFields(fields: CustomField[]): Promise<void> {
  await writeCachedJson("customFieldsCache", "customFields.json", fields);
}

/**
 * The user's own language levels (spec_3 item 2) — same cache-then-Drive pattern as
 * Custom Fields, compared against a posting's detected language requirements.
 */
export async function getLanguageLevels(): Promise<LanguageLevel[]> {
  return (await readCachedJson("languageLevelsCache", "languageLevels.json")) ?? [];
}

export async function saveLanguageLevels(levels: LanguageLevel[]): Promise<void> {
  await writeCachedJson("languageLevelsCache", "languageLevels.json", levels);
}

/**
 * Pre-generated FAQ answers (spec_5 section B) — same cache-then-Drive
 * pattern as Custom Fields / Language Levels.
 */
export async function getFaqAnswers(): Promise<FaqEntry[]> {
  return (await readCachedJson("faqAnswersCache", "faq.json")) ?? [];
}

export async function saveFaqAnswers(entries: FaqEntry[]): Promise<void> {
  await writeCachedJson("faqAnswersCache", "faq.json", entries);
}

/**
 * Applicant-authored instructions for how generated text should be written
 * (spec_7 item 7) — same cache-then-Drive pattern as Personal Legend/
 * Candidate Summary.
 */
export async function getGenerationRules(): Promise<GenerationRules | null> {
  return readCachedText("generationRulesCache", "generationRules.md");
}

export async function saveGenerationRules(content: string): Promise<void> {
  await writeCachedText("generationRulesCache", "generationRules.md", content);
}

/**
 * Applicant-authored instructions for the recruiter/hiring-contact outreach
 * message — same cache-then-Drive pattern as Generation Rules, kept in its
 * own Drive file so it can be edited independently.
 */
export async function getOutreachRules(): Promise<OutreachRules | null> {
  return readCachedText("outreachRulesCache", "outreachRules.md");
}

export async function saveOutreachRules(content: string): Promise<void> {
  await writeCachedText("outreachRulesCache", "outreachRules.md", content);
}
