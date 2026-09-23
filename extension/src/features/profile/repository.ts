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
  type PersonalLegend,
  type Profile,
} from "@/types/profile";
import { getLocal, setLocal } from "@/features/storage/local";
import * as drive from "@/features/google-drive/client";
import { extractPdfText } from "@/lib/pdf-text";

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
  await setLocal("legendLibraryCache", library);
  await drive.writeJsonFile("legendLibrary.json", library);
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
  const cached = await getLocal("legendLibraryCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<LegendLibrary>("legendLibrary.json");
    if (remote) {
      await setLocal("legendLibraryCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to the legacy migration/empty library.
  }
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

async function saveCvLibrary(library: CvLibrary): Promise<void> {
  await setLocal("cvLibraryCache", library);
  await drive.writeJsonFile("cvLibrary.json", library);
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
  const cached = await getLocal("cvLibraryCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<CvLibrary>("cvLibrary.json");
    if (remote) {
      await setLocal("cvLibraryCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to the legacy migration/empty library.
  }
  const migrated = await migrateLegacyCv();
  await saveCvLibrary(migrated);
  return migrated;
}

/** The CV autofill/AI/context-menu treat as "the" CV — the library's active entry. */
export async function getCvMeta(): Promise<CvMeta | null> {
  const library = await getCvLibrary();
  return library.items.find((cv) => cv.id === library.activeId) ?? null;
}

export async function uploadCv(file: File, extractedText: string): Promise<CvMeta> {
  const id = crypto.randomUUID();
  const driveFileId = await drive.writeBinaryFile(cvFileName(id), file);
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

/** Removes one CV from the library. If it was active, the next remaining entry (if any) becomes active. */
export async function deleteCv(id: string): Promise<void> {
  const library = await getCvLibrary();
  const meta = library.items.find((cv) => cv.id === id);
  if (!meta) return;
  await drive.deleteFile(cvFileName(meta.id));
  const items = library.items.filter((cv) => cv.id !== id);
  const activeId = library.activeId === id ? (items[0]?.id ?? null) : library.activeId;
  await saveCvLibrary({ items, activeId });
}

/**
 * Custom fields (spec_2 item 1) — same cache-then-Drive pattern as Profile,
 * but stored separately since they're drag-only and never fed into autofill.
 */
export async function getCustomFields(): Promise<CustomField[]> {
  const cached = await getLocal("customFieldsCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<CustomField[]>("customFields.json");
    if (remote) {
      await setLocal("customFieldsCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to empty list.
  }
  return [];
}

export async function saveCustomFields(fields: CustomField[]): Promise<void> {
  await setLocal("customFieldsCache", fields);
  await drive.writeJsonFile("customFields.json", fields);
}

/**
 * The user's own language levels (spec_3 item 2) — same cache-then-Drive pattern as
 * Custom Fields, compared against a posting's detected language requirements.
 */
export async function getLanguageLevels(): Promise<LanguageLevel[]> {
  const cached = await getLocal("languageLevelsCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<LanguageLevel[]>("languageLevels.json");
    if (remote) {
      await setLocal("languageLevelsCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to empty list.
  }
  return [];
}

export async function saveLanguageLevels(levels: LanguageLevel[]): Promise<void> {
  await setLocal("languageLevelsCache", levels);
  await drive.writeJsonFile("languageLevels.json", levels);
}

/**
 * Pre-generated FAQ answers (spec_5 section B) — same cache-then-Drive
 * pattern as Custom Fields / Language Levels.
 */
export async function getFaqAnswers(): Promise<FaqEntry[]> {
  const cached = await getLocal("faqAnswersCache");
  if (cached) return cached;
  try {
    const remote = await drive.readJsonFile<FaqEntry[]>("faq.json");
    if (remote) {
      await setLocal("faqAnswersCache", remote);
      return remote;
    }
  } catch {
    // Google not connected yet — fall through to empty list.
  }
  return [];
}

export async function saveFaqAnswers(entries: FaqEntry[]): Promise<void> {
  await setLocal("faqAnswersCache", entries);
  await drive.writeJsonFile("faq.json", entries);
}

/**
 * Applicant-authored instructions for how generated text should be written
 * (spec_7 item 7) — same cache-then-Drive pattern as Personal Legend/
 * Candidate Summary.
 */
export async function getGenerationRules(): Promise<GenerationRules | null> {
  const cached = await getLocal("generationRulesCache");
  if (cached) return cached;
  try {
    const content = await drive.readTextFile("generationRules.md");
    if (content !== null) {
      const rules: GenerationRules = { content, updatedAt: new Date().toISOString() };
      await setLocal("generationRulesCache", rules);
      return rules;
    }
  } catch {
    // Google not connected yet.
  }
  return null;
}

export async function saveGenerationRules(content: string): Promise<void> {
  const rules: GenerationRules = { content, updatedAt: new Date().toISOString() };
  await setLocal("generationRulesCache", rules);
  await drive.writeTextFile("generationRules.md", content);
}
