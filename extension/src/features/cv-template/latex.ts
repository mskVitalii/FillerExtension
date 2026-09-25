import { unzipSync } from "fflate";

/**
 * A LaTeX CV — an Overleaf project downloaded as .zip (main .tex, photo,
 * class/style files), or a single .tex. Placeholders are typed into the
 * source the way LaTeX prints braces, `\{\{city\}\}` (and `job\_position` for
 * an underscore), so the compiled PDF shows `{{city}}` just like any other CV.
 * Per posting only those are replaced, and the project is compiled again.
 *
 * There's no TeX engine that runs in the browser without a TeX Live mirror
 * behind it, so compiling goes through LaTeX-On-HTTP
 * (https://github.com/YtoTech/latex-on-http), a free open-source service with
 * a full TeX Live. The project's files are sent there for each compile.
 */

export const LATEX_COMPILE_URL = "https://latex.ytotech.com/builds/sync";
export const LATEX_COMPILE_HOST = "latex.ytotech.com";

export interface LatexProject {
  /** Path → bytes, with a single wrapping folder (a zip of a folder) stripped. */
  files: Map<string, Uint8Array>;
  mainPath: string;
}

const TEXT_EXTENSIONS = /\.(tex|cls|sty|bib|bst|bbx|cbx|lbx|dbx|def|cfg|clo|fd|ltx|txt|md)$/i;

export function isLatexFile(file: { name: string; type: string }): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".tex") || name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/** The .tex file with `\documentclass`, preferring the conventional names Overleaf and most templates use. */
function findMain(files: Map<string, Uint8Array>): string | null {
  const candidates = [...files.keys()].filter((path) => path.toLowerCase().endsWith(".tex"));
  const withClass = candidates.filter((path) => /\\documentclass/.test(decodeUtf8(files.get(path)!)));
  const pool = withClass.length > 0 ? withClass : candidates;
  const preferred = pool.find((path) => /(^|\/)(main|cv|resume)\.tex$/i.test(path));
  return preferred ?? pool.sort((a, b) => a.split("/").length - b.split("/").length)[0] ?? null;
}

export async function readLatexProject(file: File): Promise<LatexProject> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let files = new Map<string, Uint8Array>();
  if (file.name.toLowerCase().endsWith(".tex")) {
    files.set("main.tex", bytes);
  } else {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(bytes);
    } catch {
      throw new Error("Couldn't open the .zip — download the project again from Overleaf (Menu → Download → Source).");
    }
    for (const [path, content] of Object.entries(entries)) {
      if (path.endsWith("/") || path.startsWith("__MACOSX/") || /(^|\/)\.DS_Store$/.test(path)) continue;
      files.set(path, content);
    }
    // "Compress folder" zips wrap everything in one folder — LaTeX-On-HTTP compiles from the root.
    const tops = new Set([...files.keys()].map((path) => (path.includes("/") ? path.split("/")[0] : "")));
    if (tops.size === 1 && !tops.has("")) {
      const prefix = `${[...tops][0]}/`;
      files = new Map([...files].map(([path, content]) => [path.slice(prefix.length), content]));
    }
  }
  const mainPath = findMain(files);
  if (!mainPath) throw new Error("No .tex file with \\documentclass found in the project.");
  return { files, mainPath };
}

export function mainSource(project: LatexProject): string {
  return decodeUtf8(project.files.get(project.mainPath)!);
}

/** `\{\{name\}\}` as LaTeX prints `{{name}}`; `\_` inside the name is an underscore. Spaces are tolerated. */
const LATEX_PLACEHOLDER_RE = /\\\{\s*\\\{\s*((?:[A-Za-z_]|\\_)(?:[\w-]|\\_)*)\s*\\\}\s*\\\}/g;

function placeholderName(raw: string): string {
  return raw.replace(/\\_/g, "_");
}

export function latexPlaceholderNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(LATEX_PLACEHOLDER_RE)) {
    const name = placeholderName(match[1]);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Plain text made safe for LaTeX's text mode. */
export function escapeLatex(text: string): string {
  return text.replace(/[\\{}$&#%_~^]/g, (char) => {
    switch (char) {
      case "\\":
        return "\\textbackslash{}";
      case "~":
        return "\\textasciitilde{}";
      case "^":
        return "\\textasciicircum{}";
      default:
        return `\\${char}`;
    }
  });
}

/**
 * The main source with placeholders replaced. A value that is one of the
 * variable's own variants is inserted as written — the user wrote it for
 * this document, so `\textbf{Go}` or a block of `\item`s works. Anything
 * else (an AI-written city, a custom value) is escaped as plain text.
 */
export function fillLatexSource(source: string, values: Record<string, string>, isVerbatim: (name: string, value: string) => boolean): string {
  return source.replace(LATEX_PLACEHOLDER_RE, (_, raw: string) => {
    const name = placeholderName(raw);
    const value = values[name] ?? "";
    return isVerbatim(name, value) ? value : escapeLatex(value);
  });
}

/** Which engine the project needs: system fonts (fontspec) mean XeLaTeX, Lua code LuaLaTeX, everything else pdfLaTeX. */
export function detectCompiler(source: string): "pdflatex" | "xelatex" | "lualatex" {
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(luacode|luatexbase)\b/.test(source) || /\\directlua\b/.test(source)) return "lualatex";
  if (/\\usepackage(\[[^\]]*\])?\{[^}]*\b(fontspec|polyglossia|unicode-math)\b/.test(source) || /\\set(main|sans|mono)font\b/.test(source)) {
    return "xelatex";
  }
  return "pdflatex";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** The first TeX error ("! LaTeX Error: File `x.sty' not found.") with the line after it, from a failed build's log. */
function firstTexError(log: string): string | null {
  const lines = log.split("\n");
  const index = lines.findIndex((line) => line.startsWith("! "));
  if (index === -1) return null;
  return lines
    .slice(index, index + 2)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compiles the project (with `source` as its main file) to a PDF. */
export async function compileLatex(project: LatexProject, source: string, options: { signal?: AbortSignal } = {}): Promise<Blob> {
  const resources = [...project.files].map(([path, bytes]) => {
    if (path === project.mainPath) return { main: true, path, content: source };
    if (TEXT_EXTENSIONS.test(path)) return { path, content: decodeUtf8(bytes) };
    return { path, file: toBase64(bytes) };
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  options.signal?.addEventListener("abort", () => controller.abort());
  let response: Response;
  try {
    response = await fetch(LATEX_COMPILE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ compiler: detectCompiler(source), resources }),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`Compiling the LaTeX CV timed out (${LATEX_COMPILE_HOST}).`);
    throw new Error(`Couldn't reach the LaTeX compiler (${LATEX_COMPILE_HOST}): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.ok && type.includes("pdf")) return new Blob([await response.arrayBuffer()], { type: "application/pdf" });
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: string; logs?: string; log_files?: Record<string, string> };
    const log = [...Object.values(body.log_files ?? {}), body.logs ?? ""].join("\n");
    detail = firstTexError(log) ?? body.error ?? detail;
  } catch {
    // Not JSON — keep the status.
  }
  throw new Error(`LaTeX compile failed: ${detail}`);
}
