import { getGoogleToken } from "./auth";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";

/**
 * Minimal Drive appDataFolder client (spec section 6, 20). Keeps
 * application data — profile.json, settings.json, legend.md, cv.pdf,
 * applications/* — entirely in the user's own Drive, never on a backend.
 */
async function authHeaders(): Promise<HeadersInit> {
  const token = await getGoogleToken(true);
  if (!token) throw new Error("Google is not connected.");
  return { Authorization: `Bearer ${token}` };
}

async function findFileByName(name: string): Promise<string | null> {
  const headers = await authHeaders();
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name = '${name}' and trashed = false`,
    fields: "files(id, name)",
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`Drive lookup failed: ${res.status}`);
  const data = (await res.json()) as { files: { id: string; name: string }[] };
  return data.files[0]?.id ?? null;
}

export async function readJsonFile<T>(name: string): Promise<T | null> {
  const fileId = await findFileByName(name);
  if (!fileId) return null;
  const headers = await authHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { headers });
  if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function readBinaryFile(name: string): Promise<Blob | null> {
  const fileId = await findFileByName(name);
  if (!fileId) return null;
  const headers = await authHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { headers });
  if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
  return res.blob();
}

export async function readTextFile(name: string): Promise<string | null> {
  const fileId = await findFileByName(name);
  if (!fileId) return null;
  const headers = await authHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, { headers });
  if (!res.ok) throw new Error(`Drive read failed: ${res.status}`);
  return res.text();
}

async function upsertFile(name: string, blob: Blob, mimeType: string): Promise<string> {
  const headers = await authHeaders();
  const existingId = await findFileByName(name);

  const metadata = existingId ? { name, mimeType } : { name, mimeType, parents: ["appDataFolder"] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", blob, name);

  const url = existingId
    ? `${DRIVE_UPLOAD_URL}/${existingId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_URL}?uploadType=multipart`;
  const method = existingId ? "PATCH" : "POST";

  const res = await fetch(url, { method, headers, body: form });
  if (!res.ok) throw new Error(`Drive write failed: ${res.status}`);
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function writeJsonFile(name: string, value: unknown): Promise<string> {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  return upsertFile(name, blob, "application/json");
}

export async function writeTextFile(name: string, content: string): Promise<string> {
  const blob = new Blob([content], { type: "text/plain" });
  return upsertFile(name, blob, "text/plain");
}

export async function writeBinaryFile(name: string, file: File): Promise<string> {
  return upsertFile(name, file, file.type || "application/octet-stream");
}

export async function deleteFile(name: string): Promise<void> {
  const fileId = await findFileByName(name);
  if (!fileId) return;
  const headers = await authHeaders();
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}`, { method: "DELETE", headers });
  if (!res.ok && res.status !== 404) throw new Error(`Drive delete failed: ${res.status}`);
}

export async function listApplicationFiles(): Promise<string[]> {
  const headers = await authHeaders();
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: "name contains 'applications/' and trashed = false",
    fields: "files(name)",
  });
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, { headers });
  if (!res.ok) throw new Error(`Drive list failed: ${res.status}`);
  const data = (await res.json()) as { files: { name: string }[] };
  return data.files.map((f) => f.name);
}
