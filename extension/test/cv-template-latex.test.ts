import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  compileLatex,
  detectCompiler,
  escapeLatex,
  fillLatexSource,
  latexPlaceholderNames,
  mainSource,
  readLatexProject,
} from "@/features/cv-template/latex";

const MAIN = String.raw`\documentclass{article}
\begin{document}
\{\{city\}\}, Germany \quad \{\{ job\_position \}\}
\includegraphics{profile.png}
Skills: \{\{main\_language\}\} \{\{city\}\}
\end{document}`;

function zipFile(entries: Record<string, Uint8Array>, name = "CV_Jane.zip"): File {
  return new File([zipSync(entries)], name, { type: "application/zip" });
}

describe("readLatexProject", () => {
  it("reads an Overleaf zip and finds the main file by \\documentclass", async () => {
    const project = await readLatexProject(
      zipFile({
        "sections/work.tex": strToU8("\\section{Work}"),
        "main.tex": strToU8(MAIN),
        "profile.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      }),
    );
    expect(project.mainPath).toBe("main.tex");
    expect([...project.files.keys()].sort()).toEqual(["main.tex", "profile.png", "sections/work.tex"]);
    expect(mainSource(project)).toBe(MAIN);
  });

  it("strips the one folder a zipped folder wraps everything in, and macOS junk", async () => {
    const project = await readLatexProject(
      zipFile({
        "CV_Jane/resume.tex": strToU8(MAIN),
        "CV_Jane/photo.jpg": new Uint8Array([1]),
        "__MACOSX/CV_Jane/._photo.jpg": new Uint8Array([2]),
      }),
    );
    expect(project.mainPath).toBe("resume.tex");
    expect([...project.files.keys()].sort()).toEqual(["photo.jpg", "resume.tex"]);
  });

  it("takes a lone .tex, and explains a project without a main file", async () => {
    const single = await readLatexProject(new File([MAIN], "cv.tex"));
    expect(single.mainPath).toBe("main.tex");
    await expect(readLatexProject(zipFile({ "notes.txt": strToU8("x") }))).rejects.toThrow(/documentclass/);
  });
});

describe("LaTeX placeholders", () => {
  it("finds \\{\\{name\\}\\} with escaped underscores, deduplicated", () => {
    expect(latexPlaceholderNames(MAIN)).toEqual(["city", "job_position", "main_language"]);
  });

  it("escapes a free value, inserts one of the variable's own variants verbatim", () => {
    const filled = fillLatexSource(
      MAIN,
      { city: "Frankfurt & Main", job_position: "C# Dev_Ops 100%", main_language: "\\textbf{Go}" },
      (name, value) => name === "main_language" && value === "\\textbf{Go}",
    );
    expect(filled).toContain(String.raw`Frankfurt \& Main, Germany`);
    expect(filled).toContain(String.raw`C\# Dev\_Ops 100\%`);
    expect(filled).toContain(String.raw`Skills: \textbf{Go} Frankfurt \& Main`);
    expect(filled).not.toContain("\\{\\{");
  });

  it("escapes every special character", () => {
    expect(escapeLatex("a\\b{c}$d&e#f%g_h~i^j")).toBe(
      String.raw`a\textbackslash{}b\{c\}\$d\&e\#f\%g\_h\textasciitilde{}i\textasciicircum{}j`,
    );
  });

  it("picks the engine the preamble needs", () => {
    expect(detectCompiler(MAIN)).toBe("pdflatex");
    expect(detectCompiler("\\usepackage{fontspec}\\setmainfont{Inter}")).toBe("xelatex");
    expect(detectCompiler("\\usepackage[no-math]{fontspec}")).toBe("xelatex");
    expect(detectCompiler("\\usepackage{luacode}")).toBe("lualatex");
  });
});

describe("compileLatex", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends every file — text as content, binaries as base64 — with the filled main source", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } }));
    vi.stubGlobal("fetch", fetchMock);
    const project = await readLatexProject(zipFile({ "main.tex": strToU8(MAIN), "profile.png": new Uint8Array([0xff, 0x00]) }));
    const pdf = await compileLatex(project, "FILLED");
    expect(pdf.type).toBe("application/pdf");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://latex.ytotech.com/builds/sync");
    expect(JSON.parse(init.body as string)).toEqual({
      compiler: "pdflatex",
      resources: [
        { main: true, path: "main.tex", content: "FILLED" },
        { path: "profile.png", file: "/wA=" },
      ],
    });
  });

  it("surfaces the first TeX error from a failed build's log", async () => {
    const log = "This is pdfTeX\n(./main.tex\n! LaTeX Error: File `moderncv.cls' not found.\n\nType X to quit\n";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "COMPILATION_ERROR", log_files: { "__main_document__.log": log } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const project = await readLatexProject(new File([MAIN], "cv.tex"));
    await expect(compileLatex(project, MAIN)).rejects.toThrow("LaTeX compile failed: ! LaTeX Error: File `moderncv.cls' not found.");
  });
});
