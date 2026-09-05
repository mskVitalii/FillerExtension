/**
 * Extracts plain text from a PDF entirely client-side (spec section 9) so
 * the raw file never has to be sent to OpenAI just to get its contents.
 *
 * `pdfjs-dist` is loaded on demand — CV upload is the only path that needs
 * it, so it stays out of the Side Panel's initial bundle.
 */
export async function extractPdfText(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  const { default: pdfWorkerUrl } = await import("pdfjs-dist/build/pdf.worker.mjs?url");
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
