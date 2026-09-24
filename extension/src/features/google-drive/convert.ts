const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

const APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
/**
 * `files.export` (Google Doc → PDF) doesn't accept `drive.appdata`, only
 * `drive`/`drive.file`/`drive.readonly`. `drive.file` is the narrow one:
 * access only to files this extension itself creates. It's requested
 * *incrementally* — here, on the first conversion — instead of in
 * manifest.json: adding it there would change the scope set of every plain
 * `getAuthToken()` call, so every existing user's silent token lookup would
 * fail ("not connected") until they re-consented.
 */
const FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

async function conversionToken(): Promise<string> {
  const scopes = [APPDATA_SCOPE, FILE_SCOPE];
  const read = async (interactive: boolean) => {
    const token = await chrome.identity.getAuthToken({ interactive, scopes });
    return typeof token === "string" ? token : token.token;
  };
  try {
    const silent = await read(false);
    if (silent) return silent;
  } catch {
    // Not granted yet — fall through to the one-time consent prompt.
  }
  const token = await read(true).catch(() => undefined);
  if (!token) throw new Error("Google didn't grant access for PDF conversion.");
  return token;
}

async function uploadAsGoogleDoc(token: string, docx: Blob, parents: string[] | undefined): Promise<Response> {
  const metadata = { name: "Filler CV conversion (temporary)", mimeType: GOOGLE_DOC_MIME, ...(parents ? { parents } : {}) };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", docx);
  return fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
}

/**
 * Word → PDF through Google Docs' own converter: upload the .docx as a
 * temporary Google Doc, export it as PDF, delete it. No in-browser library
 * renders a real Word layout (fonts, floating images, Symbol bullets) — see
 * `cv-template/docx.ts` — and Word's own fonts can't be shipped in the
 * extension. Google's renderer has most Office fonts, but not every weight
 * (e.g. Calibri Light falls back to Calibri).
 *
 * The temporary doc goes to the hidden appDataFolder when Drive accepts a
 * Google Doc there, otherwise to My Drive root; either way it's deleted
 * right after export, even when the export fails.
 */
export async function convertDocxToPdf(docx: Blob): Promise<Blob> {
  const token = await conversionToken();
  let upload = await uploadAsGoogleDoc(token, docx, ["appDataFolder"]);
  if (!upload.ok) upload = await uploadAsGoogleDoc(token, docx, undefined);
  if (!upload.ok) {
    const body = await upload.text().catch(() => "");
    throw new Error(`Google Drive conversion upload failed (${upload.status}): ${body.slice(0, 200)}`);
  }
  const { id } = (await upload.json()) as { id: string };
  try {
    const exported = await fetch(`${DRIVE_FILES_URL}/${id}/export?mimeType=application%2Fpdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!exported.ok) {
      const body = await exported.text().catch(() => "");
      throw new Error(`Google Drive PDF export failed (${exported.status}): ${body.slice(0, 200)}`);
    }
    return await exported.blob();
  } finally {
    await fetch(`${DRIVE_FILES_URL}/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(
      () => undefined,
    );
  }
}
