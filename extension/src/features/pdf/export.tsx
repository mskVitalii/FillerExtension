function toParagraphs(plainText: string): string[] {
  return plainText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** TipTap content → PDF Blob → File (spec section 17), ready to upload into an ATS. */
export async function renderCoverLetterPdf(plainText: string, fileName: string): Promise<File> {
  // `@react-pdf/renderer` is ~1 MB — the single biggest thing in the bundle,
  // and only ever needed the moment the user exports/uploads a PDF. Pulling
  // it (and the document component, which imports it too) in dynamically
  // keeps it out of the Side Panel's initial load.
  const [{ pdf }, { CoverLetterDocument }] = await Promise.all([
    import("@react-pdf/renderer"),
    import("./CoverLetterDocument"),
  ]);
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

/**
 * Opens a PDF (or a plain-text file) in a new browser tab (Chrome's own
 * viewer) without saving it — the Side Panel is too narrow to judge a page layout. The blob URL belongs
 * to this extension page's origin; it's revoked after a minute, long after
 * the tab has loaded it.
 */
export async function openPdfPreview(file: File): Promise<void> {
  const url = URL.createObjectURL(file);
  await chrome.tabs.create({ url });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
