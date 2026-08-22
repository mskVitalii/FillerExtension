import { pdf } from "@react-pdf/renderer";
import { CoverLetterDocument } from "./CoverLetterDocument";

function toParagraphs(plainText: string): string[] {
  return plainText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** TipTap content → PDF Blob → File (spec section 17), ready to upload into an ATS. */
export async function renderCoverLetterPdf(plainText: string, fileName: string): Promise<File> {
  const paragraphs = toParagraphs(plainText);
  const blob = await pdf(<CoverLetterDocument paragraphs={paragraphs} />).toBlob();
  return new File([blob], fileName, { type: "application/pdf" });
}

export async function downloadFile(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  try {
    await chrome.downloads.download({ url, filename: file.name, saveAs: true });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
