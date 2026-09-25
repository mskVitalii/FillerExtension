import type { Job } from "@/types/job";
import type { CvMeta, Profile } from "@/types/profile";
import type { CvTemplate, CvValueSuggestion } from "@/types/cv-template";
import { sendMessage } from "@/types/messages";
import { getCvAdaptState, setCvAdaptState, type CvAdaptEntry } from "@/features/storage/session";
import { getCvFile } from "@/features/profile/repository";
import { saveAdaptedCv } from "@/features/applications/repository";
import interRegularUrl from "@/assets/fonts/Inter-Regular.ttf";
import interBoldUrl from "@/assets/fonts/Inter-Bold.ttf";
import interItalicUrl from "@/assets/fonts/Inter-Italic.ttf";
import { DOCX_MIME, fillDocx } from "./docx";
import { defaultValue, extractVariableNames } from "./template";

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

/** Characters Windows/macOS or `chrome.downloads` reject in a file name. */
function fileNameSafe(text: string): string {
  return text
    .replace(/[\\/:*?"<>|~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

/** "Jane Doe CV - Staffbase.pdf" — the company tells several adapted CVs in Downloads apart. */
export function adaptedCvFileName(profile: Profile, extension: "pdf" | "docx", company = ""): string {
  const name = profile.fullName.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  const suffix = fileNameSafe(company);
  return fileNameSafe(`${name ? `${name} ` : ""}CV${suffix ? ` - ${suffix}` : ""}`) + `.${extension}`;
}

export type AdaptedCvFormat = "pdf" | "docx";

export interface AdaptedCv {
  file: File;
  /** Things the user should know about this render — a placeholder that couldn't be filled, a font stand-in. */
  notes: string[];
}

/**
 * Rendered PDFs by exact input, for this Side Panel document's lifetime —
 * Preview, then Attach, then Download of the same adapted CV should cost one
 * Google Docs / LaTeX round-trip (a few seconds), not three.
 */
const pdfCache = new Map<string, Promise<{ blob: Blob; notes: string[] }>>();

function cached(key: string, render: () => Promise<{ blob: Blob; notes: string[] }>) {
  let result = pdfCache.get(key);
  if (!result) {
    result = render();
    pdfCache.set(key, result);
    // A failed render (consent dismissed, offline, compile error) must be retryable, not cached.
    result.catch(() => pdfCache.delete(key));
  }
  return result;
}

async function cvBytes(cv: CvMeta, bytes?: Uint8Array | null): Promise<Uint8Array> {
  if (bytes) return bytes;
  const file = await getCvFile(cv.id);
  if (!file) throw new Error("Couldn't load the CV from Google Drive.");
  return new Uint8Array(await file.arrayBuffer());
}

const INTER = { regular: interRegularUrl, bold: interBoldUrl, italic: interItalicUrl };

/** Inter for a value the PDF's own fonts and the Standard 14 fonts can't show (e.g. Cyrillic). */
async function loadUnicodeFont(style: { bold: boolean; italic: boolean }): Promise<Uint8Array> {
  const url = style.bold ? INTER.bold : style.italic ? INTER.italic : INTER.regular;
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

function listNames(names: string[]): string {
  return names.map((name) => `{{${name}}}`).join(", ");
}

/**
 * The final file — always the user's own CV with only its placeholders
 * filled, never a rebuilt one:
 * - Word: the same .docx with the placeholders' text replaced — as-is for
 *   `docx`, or converted by Google Docs for `pdf` (`google-drive/convert.ts`).
 * - PDF: the same PDF with the placeholders redrawn in place (`pdf.ts`).
 * - LaTeX: the project with the placeholders replaced in its main source,
 *   compiled again (`latex.ts`).
 * `source` can be passed when the caller already holds the CV's bytes,
 * saving a Drive round-trip.
 */
export async function renderAdaptedCv(
  cv: CvMeta,
  template: CvTemplate,
  values: Record<string, string>,
  profile: Profile,
  options: { format?: AdaptedCvFormat; source?: Uint8Array | null; company?: string } = {},
): Promise<AdaptedCv> {
  const format = template.format === "docx" ? (options.format ?? "pdf") : "pdf";
  const fileName = adaptedCvFileName(profile, format, options.company);
  const key = JSON.stringify([cv.id, cv.uploadedAt, values]);

  if (template.format === "docx") {
    const filled = new Uint8Array(fillDocx(await cvBytes(cv, options.source), values));
    if (format === "docx") return { file: new File([filled as Uint8Array<ArrayBuffer>], fileName, { type: DOCX_MIME }), notes: [] };
    const { blob } = await cached(key, async () => {
      const [{ convertDocxToPdf }, { bakePictureShapes }] = await Promise.all([
        import("@/features/google-drive/convert"),
        import("./docx-shapes"),
      ]);
      // Google Docs drops Word's rounded/circular photo masks — bake them into the image first.
      const baked = await bakePictureShapes(filled);
      return { blob: await convertDocxToPdf(new Blob([new Uint8Array(baked)], { type: DOCX_MIME })), notes: [] };
    });
    return { file: new File([blob], fileName, { type: "application/pdf" }), notes: [] };
  }

  if (template.format === "latex") {
    const variables = template.variables;
    const { blob } = await cached(key, async () => {
      const latex = await import("./latex");
      const bytes = await cvBytes(cv, options.source);
      const project = await latex.readLatexProject(new File([bytes as Uint8Array<ArrayBuffer>], cv.fileName));
      const source = latex.fillLatexSource(latex.mainSource(project), values, (name, value) =>
        Boolean(variables.find((v) => v.name === name)?.options.includes(value)),
      );
      return { blob: await latex.compileLatex(project, source), notes: [] };
    });
    return { file: new File([blob], fileName, { type: "application/pdf" }), notes: [] };
  }

  const { blob, notes } = await cached(key, async () => {
    const { fillPdf } = await import("./pdf");
    const result = await fillPdf(await cvBytes(cv, options.source), values, { loadUnicodeFont });
    const found: string[] = [];
    if (result.notFound.length > 0) {
      found.push(`Not found in the PDF's text, left unchanged: ${listNames(result.notFound)}. Was the text turned into outlines?`);
    }
    if (result.substitutedFont.length > 0) {
      found.push(`Your PDF's font doesn't include every letter of ${listNames(result.substitutedFont)}, so a similar standard font was used there.`);
    }
    return { blob: new Blob([result.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), notes: found };
  });
  return { file: new File([blob], fileName, { type: "application/pdf" }), notes };
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
