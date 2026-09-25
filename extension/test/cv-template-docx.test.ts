import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { fillDocx, readDocxText } from "@/features/cv-template/docx";
import { templateForCv } from "@/features/cv-template/repository";
import type { CvMeta } from "@/types/profile";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A minimal but real-shaped package: Word writes `[Content_Types].xml` first and splits typed text into many runs. */
function makeDocx(bodyXml: string, extra: Record<string, string> = {}): Uint8Array {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document ${W}><w:body>${bodyXml}</w:body></w:document>`;
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types/>'),
    "word/document.xml": strToU8(document),
    "word/media/image1.png": new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });
}

const run = (text: string, rPr = "") => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const BOLD = "<w:rPr><w:b/></w:rPr>";

function documentXml(bytes: Uint8Array): string {
  return strFromU8(unzipSync(bytes)["word/document.xml"]);
}

describe("fillDocx", () => {
  it("replaces a placeholder Word split across runs, keeping the formatting of the run where {{ starts", () => {
    const docx = makeDocx(`<w:p>${run("Address: ")}${run("{{ci", BOLD)}<w:proofErr w:type="spellStart"/>${run("ty}}")}${run(", Germany")}</w:p>`);
    const out = fillDocx(docx, { city: "Berlin" });
    expect(readDocxText(out)).toBe("Address: Berlin, Germany");
    // "Berlin" sits in the bold run; the run that held "ty}}" is left empty.
    expect(documentXml(out)).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Berlin</w:t></w:r>');
  });

  it("fills several placeholders in one paragraph and leaves unknown ones empty", () => {
    const docx = makeDocx(`<w:p>${run("{{job_position}} in {{city}} ({{nope}})")}</w:p>`);
    expect(readDocxText(fillDocx(docx, { job_position: "Backend Engineer", city: "Amsterdam" }))).toBe(
      "Backend Engineer in Amsterdam ()",
    );
  });

  it("turns a multi-line value into line breaks inside the same run", () => {
    const docx = makeDocx(`<w:p>${run("{{bullets}}")}</w:p>`);
    const out = fillDocx(docx, { bullets: "Go services\nKafka pipelines" });
    expect(documentXml(out)).toMatch(/Go services<\/w:t><w:br\/><w:t xml:space="preserve">Kafka pipelines/);
    expect(readDocxText(out)).toBe("Go services\nKafka pipelines");
  });

  it("keeps every part it didn't need to touch byte-identical, and the XML declaration", () => {
    const docx = makeDocx(`<w:p>${run("{{city}}")}</w:p>`, {
      "word/header1.xml": `<w:hdr ${W}><w:p>${run("{{city}} header")}</w:p></w:hdr>`,
      "word/styles.xml": `<w:styles ${W}/>`,
    });
    const before = unzipSync(docx);
    const after = unzipSync(fillDocx(docx, { city: "Dresden" }));
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(after["word/media/image1.png"]).toEqual(before["word/media/image1.png"]);
    expect(after["word/styles.xml"]).toEqual(before["word/styles.xml"]);
    expect(strFromU8(after["word/header1.xml"])).toContain("Dresden header");
    expect(strFromU8(after["word/document.xml"]).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
  });

  it("rejects a file that isn't a .docx", () => {
    expect(() => readDocxText(new Uint8Array([1, 2, 3]))).toThrow(/docx/);
  });
});

describe("readDocxText", () => {
  it("reads tabs and line breaks, one line per paragraph, headers first", () => {
    const docx = makeDocx(`<w:p>${run("Address:")}<w:r><w:tab/></w:r>${run("{{city}}")}</w:p><w:p>${run("a")}<w:r><w:br/></w:r>${run("b")}</w:p>`, {
      "word/header1.xml": `<w:hdr ${W}><w:p>${run("Top")}</w:p></w:hdr>`,
    });
    expect(readDocxText(docx)).toBe("Top\nAddress:\t{{city}}\na\nb");
  });
});

describe("templateForCv", () => {
  const cv = (overrides: Partial<CvMeta>): CvMeta => ({
    id: "cv1",
    fileName: "CV.pdf",
    mimeType: "application/pdf",
    driveFileId: null,
    text: "",
    uploadedAt: "",
    ...overrides,
  });

  it("a Word CV is its own template: text from the file, stored placeholder settings kept", () => {
    const word = cv({ fileName: "CV.docx", mimeType: "", text: "Address: {{city}} · {{main_language}}" });
    const template = templateForCv(word, {
      cv1: {
        format: "docx",
        content: "stale text",
        variables: [{ name: "city", description: "d", options: ["Berlin"], mode: "free" }],
        updatedAt: "t",
      },
    });
    expect(template.format).toBe("docx");
    expect(template.content).toBe(word.text);
    expect(template.variables.map((v) => v.name)).toEqual(["city", "main_language"]);
    expect(template.variables[0].options).toEqual(["Berlin"]);
  });

  it("every CV is its own template — a PDF or LaTeX one too; an old Markdown entry keeps only its variables", () => {
    const pdf = templateForCv(cv({ text: "Jane Doe {{cit y}}, Germany" }), {
      cv1: {
        format: "markdown" as never,
        content: "# Old template {{job_position}}",
        variables: [{ name: "city", description: "mine", options: ["Berlin"], mode: "free" }],
        updatedAt: "t",
      },
    });
    expect(pdf).toMatchObject({ format: "pdf", content: "Jane Doe {{city}}, Germany" });
    expect(pdf.variables).toEqual([{ name: "city", description: "mine", options: ["Berlin"], mode: "free" }]);
    expect(templateForCv(cv({ fileName: "CV_Jane.zip", mimeType: "application/zip" }), {}).format).toBe("latex");
    expect(templateForCv(cv({ fileName: "main.tex", mimeType: "" }), {}).format).toBe("latex");
  });

  it("templates never leak across CVs", () => {
    const template = templateForCv(cv({ id: "cv2", text: "{{city}}" }), {
      cv1: { format: "pdf", content: "", variables: [{ name: "city", description: "cv1's", options: ["X"], mode: "choice" }], updatedAt: "" },
    });
    expect(template.variables[0].description).not.toBe("cv1's");
  });
});
