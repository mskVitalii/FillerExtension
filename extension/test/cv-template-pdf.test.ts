import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { fillPdf, listPdfPlaceholders, pdfStreamText } from "@/features/cv-template/pdf";

/**
 * Both fixtures are synthetic "Jane Doe" CVs with placeholders:
 * - latex-placeholders.pdf — pdfTeX, Latin Modern Type1 subsets, interword
 *   spaces drawn as TJ kerns, a date pushed right with \hfill (a huge kern).
 * - chrome-placeholders.pdf — Chrome's "Save as PDF" of
 *   chrome-placeholders.html: Type0/Identity-H TrueType subsets, lines split
 *   into chunks placed with their own Td — the same shape Google Docs and
 *   most HTML-to-PDF CV builders produce.
 */
const fixture = (name: string) => new Uint8Array(fs.readFileSync(path.resolve(__dirname, "pdf-fixtures", name)));
const inter = async () => new Uint8Array(fs.readFileSync(path.resolve(__dirname, "../src/assets/fonts/Inter-Regular.ttf")));

interface Item {
  str: string;
  x: number;
  y: number;
  font: string;
}

/** What a real viewer / ATS parser reads, with positions. */
async function textItems(bytes: Uint8Array): Promise<Item[]> {
  const doc = await pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items
    .filter((item): item is (typeof content.items)[number] & { str: string; transform: number[]; fontName: string } => "str" in item)
    // pdf.js prefixes font ids per document ("g_d3_f2") — keep the per-document part.
    .map((item) => ({ str: item.str, x: item.transform[4], y: item.transform[5], font: item.fontName.replace(/^g_d\d+_/, "") }))
    .filter((item) => item.str.trim());
}

async function pageText(bytes: Uint8Array): Promise<string> {
  return (await textItems(bytes)).map((item) => item.str).join(" ");
}

function itemContaining(items: Item[], text: string): Item {
  const found = items.find((item) => item.str.includes(text));
  if (!found) throw new Error(`"${text}" not in ${JSON.stringify(items.map((i) => i.str))}`);
  return found;
}

describe("fillPdf — LaTeX-made PDF", () => {
  it("finds the placeholders pdfTeX drew, even kerned apart mid-name", async () => {
    expect(await listPdfPlaceholders(fixture("latex-placeholders.pdf"))).toEqual([
      "job_position",
      "city",
      "company",
      "main_language",
    ]);
  });

  it("fills in the PDF's own font when its subset has the glyphs, and the rest of the line follows", async () => {
    const original = fixture("latex-placeholders.pdf");
    const result = await fillPdf(original, { city: "Chemnitz", main_language: "Go" });
    expect(result.filled.sort()).toEqual(["city", "company", "job_position", "main_language"]);
    expect(result.substitutedFont).toEqual([]);
    expect(result.notFound).toEqual([]);

    const text = await pageText(result.bytes);
    expect(text).toContain("Chemnitz, Germany");
    expect(text).toContain("Skills: Go, Docker");
    expect(text).not.toContain("{{");

    const before = await textItems(original);
    const after = await textItems(result.bytes);
    // Same font resource as the surrounding text — no stand-in.
    expect(itemContaining(after, "Chemnitz, Germany").font).toBe(itemContaining(before, "{{city}}").font);
    // "Go" is narrower than "{{main_language}}": what followed it on the line moved left with it.
    expect(itemContaining(after, "Go, Docker").x).toBeCloseTo(itemContaining(before, "Skills:").x, 1);
  });

  it("uses spaces the way the document does — TeX fonts draw none, so they become kerns", async () => {
    const result = await fillPdf(fixture("latex-placeholders.pdf"), { city: "Frankfurt am Main" });
    expect(result.substitutedFont).toEqual([]);
    expect(await pageText(result.bytes)).toContain("Frankfurt am Main, Germany");
  });

  it("keeps a right-aligned date in place when the text before its \\hfill changes width", async () => {
    const original = fixture("latex-placeholders.pdf");
    const date = itemContaining(await textItems(original), "2021");
    for (const company of ["Staffbase GmbH", "X"]) {
      const result = await fillPdf(original, { company });
      const after = await textItems(result.bytes);
      expect(itemContaining(after, "2021").x).toBeCloseTo(date.x, 1);
      expect(await pageText(result.bytes)).toContain(company);
    }
  });

  it("draws a value with letters the subset lacks in a matching standard font — bold stays bold", async () => {
    const result = await fillPdf(fixture("latex-placeholders.pdf"), { company: "Qwixby" });
    expect(result.substitutedFont).toEqual(["company"]);
    expect(await pageText(result.bytes)).toContain("Qwixby");
    const doc = await PDFDocument.load(result.bytes);
    const fonts = doc.getPages()[0].node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const added = fonts
      .keys()
      .filter((key) => key.decodeText().startsWith("FillerF"))
      .map((key) => fonts.lookup(key, PDFDict).lookup(PDFName.of("BaseFont"), PDFName).decodeText());
    // {{company}} was set in LMRoman10-Bold.
    expect(added).toEqual(["Times-Bold"]);
  });

  it("falls back to a Unicode font for text outside WinAnsi", async () => {
    const result = await fillPdf(fixture("latex-placeholders.pdf"), { city: "Москва" }, { loadUnicodeFont: inter });
    expect(result.substitutedFont).toEqual(["city"]);
    expect(await pageText(result.bytes)).toContain("Москва");
  });

  it("an empty value removes the placeholder; values for placeholders the PDF lacks are reported", async () => {
    const result = await fillPdf(fixture("latex-placeholders.pdf"), { job_position: "", headline: "x" });
    expect(result.notFound).toEqual(["headline"]);
    const [stream] = await pdfStreamText(result.bytes);
    expect(stream).not.toContain("{{job_position}}");
  });
});

describe("fillPdf — Chrome-made PDF (CID fonts, lines split into positioned chunks)", () => {
  it("fills every placeholder and keeps the text layer readable", async () => {
    const result = await fillPdf(fixture("chrome-placeholders.pdf"), {
      job_position: "Senior Backend Engineer",
      city: "Chemnitz",
      main_language: "Go",
    });
    expect(result.notFound).toEqual([]);
    const text = await pageText(result.bytes);
    expect(text).toContain("Senior Backend Engineer");
    expect(text).toContain("Chemnitz, Germany");
    expect(text).not.toContain("{{");
  });

  it("pulls a chunk that sat flush against the placeholder along, but not a right-aligned one", async () => {
    const original = fixture("chrome-placeholders.pdf");
    const before = await textItems(original);
    const result = await fillPdf(original, { main_language: "Go" });
    const after = await textItems(result.bytes);
    // Chrome drew ", Kubernetes, PostgreSQL." as its own chunk right after "{{main_language}}, Docker".
    // pdf.js joins chunks into one item only when they touch — so after the fill they must again.
    expect(before.some((item) => item.str.includes("Docker, Kubernetes"))).toBe(true);
    expect(itemContaining(after, "Go, Docker, Kubernetes").x).toBeCloseTo(itemContaining(before, "Docker").x, 1);
    expect(itemContaining(after, "2021").x).toBeCloseTo(itemContaining(before, "2021").x, 1);
  });

  it("a PDF without placeholders comes back with the same text", async () => {
    const { bytes: filled } = await fillPdf(fixture("chrome-placeholders.pdf"), { city: "Chemnitz" });
    const again = await fillPdf(filled, {});
    expect(again.filled).toEqual([]);
    expect(await pageText(again.bytes)).toBe(await pageText(filled));
  });
});
