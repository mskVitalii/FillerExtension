import { extractPdfText } from "./pdf-text";
import { DOCX_MIME, readDocxText } from "@/features/cv-template/docx";

export function isDocxFile(file: { name: string; type: string }): boolean {
  return file.type === DOCX_MIME || file.name.toLowerCase().endsWith(".docx");
}

/** The CV's plain text for AI context — a PDF via pdf.js, a Word file straight from its XML. */
export async function extractCvText(file: File): Promise<string> {
  if (isDocxFile(file)) return readDocxText(new Uint8Array(await file.arrayBuffer()));
  return extractPdfText(file);
}

/** Some OSes hand a .docx to `<input type=file>` with an empty MIME type — fix it so the stored CvMeta and later uploads say what it is. */
export function normalizeCvFile(file: File): File {
  if (isDocxFile(file) && file.type !== DOCX_MIME) return new File([file], file.name, { type: DOCX_MIME });
  return file;
}
