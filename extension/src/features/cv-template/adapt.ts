import type { Job } from "@/types/job";
import type { CvMeta, Profile } from "@/types/profile";
import type { CvTemplate, CvValueSuggestion } from "@/types/cv-template";
import { sendMessage } from "@/types/messages";
import { getCvAdaptState, setCvAdaptState, type CvAdaptEntry } from "@/features/storage/session";
import { getCvFile } from "@/features/profile/repository";
import { saveAdaptedCv } from "@/features/applications/repository";
import { DOCX_MIME, fillDocx } from "./docx";
import { defaultValue, extractVariableNames, fillTemplate } from "./template";

/**
 * Side-Panel-side glue shared by the Adapt CV tab and the main view's
 * "adapted CV" buttons: per-tab/per-CV value state, the AI suggestion
 * round-trip, and turning a template + values into the final file.
 */

export const EMPTY_ADAPT_ENTRY: CvAdaptEntry = { values: {}, reasons: {}, aiSuggested: false };

export async function loadAdaptEntry(tabId: number, url: string, cvId: string): Promise<CvAdaptEntry> {
  const state = await getCvAdaptState(tabId);
  if (!state || state.url !== url) return EMPTY_ADAPT_ENTRY;
  return state.byCv?.[cvId] ?? EMPTY_ADAPT_ENTRY;
}

export async function saveAdaptEntry(tabId: number, url: string, cvId: string, entry: CvAdaptEntry): Promise<void> {
  const state = await getCvAdaptState(tabId);
  const byCv = state && state.url === url ? (state.byCv ?? {}) : {};
  await setCvAdaptState(tabId, { url, byCv: { ...byCv, [cvId]: entry } });
}

/** Placeholders the template actually uses — definitions of removed ones are kept in storage but never filled. */
export function usedVariables(template: CvTemplate) {
  const names = extractVariableNames(template.content);
  return template.variables.filter((v) => names.includes(v.name));
}

/** Explicit (user/AI) value, else the offline default — the posting's most-mentioned variant, else the first one. */
export function resolveValues(template: CvTemplate, job: Job, values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(usedVariables(template).map((v) => [v.name, values[v.name] ?? defaultValue(v, job)]));
}

/** AI picks every placeholder's value for `job`, merged over `entry` (a hand-picked value is replaced too — this is an explicit re-suggest). */
export async function suggestEntry(job: Job, template: CvTemplate, entry: CvAdaptEntry): Promise<CvAdaptEntry> {
  const response = await sendMessage<{ type: "CV_VALUES"; values: CvValueSuggestion[] }>({
    type: "SUGGEST_CV_VALUES",
    job,
    template,
  });
  const values = { ...entry.values };
  const reasons = { ...entry.reasons };
  for (const suggestion of response.values) {
    values[suggestion.name] = suggestion.value;
    if (suggestion.reason) reasons[suggestion.name] = suggestion.reason;
    else delete reasons[suggestion.name];
  }
  return { values, reasons, aiSuggested: true };
}

export function adaptedCvFileName(profile: Profile, extension: "pdf" | "docx"): string {
  const name = profile.fullName.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return `${name ? `${name} ` : ""}CV.${extension}`;
}

export type AdaptedCvFormat = "pdf" | "docx";

/**
 * Converted PDFs by exact input, for this Side Panel document's lifetime —
 * Preview, then Attach, then Download of the same adapted CV should cost one
 * Google Drive round-trip (a few seconds), not three.
 */
const pdfCache = new Map<string, Promise<Blob>>();

async function wordCvBytes(cv: CvMeta, docx?: Uint8Array | null): Promise<Uint8Array> {
  if (docx) return docx;
  const file = await getCvFile(cv.id);
  if (!file) throw new Error("Couldn't load the Word CV from Google Drive.");
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * The final file. A Word CV: the same .docx with only its placeholders'
 * text replaced — as-is for `docx`, or converted by Google Docs for `pdf`
 * (see `google-drive/convert.ts`). A Markdown template always renders to
 * PDF here. `docx` can be passed when the caller already holds the Word
 * CV's bytes, saving a Drive round-trip.
 */
export async function renderAdaptedCv(
  cv: CvMeta,
  template: CvTemplate,
  values: Record<string, string>,
  profile: Profile,
  options: { format?: AdaptedCvFormat; docx?: Uint8Array | null } = {},
): Promise<File> {
  const format = options.format ?? "pdf";
  if (template.format === "docx") {
    const filled = new Uint8Array(fillDocx(await wordCvBytes(cv, options.docx), values));
    const docxBlob = new Blob([filled], { type: DOCX_MIME });
    if (format === "docx") return new File([docxBlob], adaptedCvFileName(profile, "docx"), { type: DOCX_MIME });
    const key = JSON.stringify([cv.id, cv.uploadedAt, values]);
    let pdf = pdfCache.get(key);
    if (!pdf) {
      const { convertDocxToPdf } = await import("@/features/google-drive/convert");
      pdf = convertDocxToPdf(docxBlob);
      pdfCache.set(key, pdf);
      // A failed conversion (consent dismissed, offline) must be retryable, not cached.
      pdf.catch(() => pdfCache.delete(key));
    }
    return new File([await pdf], adaptedCvFileName(profile, "pdf"), { type: "application/pdf" });
  }
  const { renderCvPdf } = await import("@/features/pdf/export");
  return renderCvPdf(fillTemplate(template.content, values), adaptedCvFileName(profile, "pdf"));
}

/** Last saved input per posting URL — Preview, then Attach, then Download of the same PDF shouldn't re-upload it three times. */
const savedKeys = new Map<string, string>();

/**
 * Keeps the adapted CV PDF with this posting's application (Applications
 * list: preview/download it later, next to the posting link). Only PDFs are
 * kept — that's what gets sent. Resolves to false when there's no
 * recognized posting to file it under, or it was already saved unchanged.
 */
export async function recordAdaptedCv(
  job: Job,
  cv: CvMeta,
  values: Record<string, string>,
  pdf: File,
): Promise<boolean> {
  // No recognized posting on this tab (Adapt CV opened on an arbitrary page) — nothing to file it under.
  if (!job.url || !(job.position || job.company)) return false;
  const key = JSON.stringify([cv.id, cv.uploadedAt, values]);
  if (savedKeys.get(job.url) === key) return false;
  await saveAdaptedCv(job, pdf, { cvId: cv.id, cvFileName: cv.fileName, values });
  savedKeys.set(job.url, key);
  return true;
}
