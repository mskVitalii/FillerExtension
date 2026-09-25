import { extractPdfText } from "./pdf-text";
import { DOCX_MIME, readDocxText } from "@/features/cv-template/docx";
import { isLatexFile } from "@/features/cv-template/latex";

export function isDocxFile(file: { name: string; type: string }): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx");
}

/** What the CV pickers accept: PDF, Word, and a LaTeX project (Overleaf .zip or a single .tex). */
export const CV_FILE_ACCEPT = `.pdf,.docx,.zip,.tex,application/pdf,${DOCX_MIME},application/zip`;

/** The CV's plain text for AI context — a PDF via pdf.js, a Word file straight from its XML. */
export async function extractCvText(file: File): Promise<string> {
  if (isDocxFile(file)) return readDocxText(new Uint8Array(await file.arrayBuffer()));
  return extractPdfText(file);
}

/** Some OSes hand a .docx to `<input type=file>` with an empty MIME type — fix it so the stored CvMeta and later uploads say what it is. */
export function normalizeCvFile(file: File): File {
  if (isDocxFile(file) && file.type !== DOCX_MIME) return new File([file], file.name, { type: DOCX_MIME });
  if (file.name.toLowerCase().endsWith(".zip") && file.type !== "application/zip") {
    return new File([file], file.name, { type: "application/zip" });
  }
  if (file.name.toLowerCase().endsWith(".tex") && file.type !== "text/x-tex") return new File([file], file.name, { type: "text/x-tex" });
  return file;
}

export interface PreparedCv {
  file: File;
  /** Plain text for AI context and placeholder detection. */
  text: string;
  /** A LaTeX CV compiled as it stands — what "Attach CV" sends, since a .zip of sources is no use to a job form. */
  pdf: File | null;
}

/** Everything the CV library stores for a newly picked file. A LaTeX project is compiled once here (a network call). */
export async function prepareCvFile(rawFile: File): Promise<PreparedCv> {
  const file = normalizeCvFile(rawFile);
  if (!isLatexFile(file)) return { file, text: await extractCvText(file), pdf: null };
  const { readLatexProject, mainSource, compileLatex } = await import("@/features/cv-template/latex");
  const project = await readLatexProject(file);
  const blob = await compileLatex(project, mainSource(project));
  const pdf = new File([blob], `${file.name.replace(/\.(zip|tex)$/i, "")}.pdf`, { type: "application/pdf" });
  return { file, text: await extractPdfText(pdf), pdf };
}
