import * as pdfjsLib from "pdfjs-dist";
// @ts-expect-error -- vite exposes the worker as a URL via ?url
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Extracts plain text from a PDF entirely client-side (spec section 9) so
 * the raw file never has to be sent to OpenAI just to get its contents.
 */
export async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts: string[] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
    pageTexts.push(text);
  }
  return pageTexts.join("\n\n").trim();
}
