import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// Vite's real build resolves this import to a fetchable URL served from the
// extension's own origin (confirmed against `dist/` — `Font.register`
// fetches it there). Under vitest there's no such server: the default
// asset transform instead returns a root-relative string
// ("/src/assets/fonts/Inter-Regular.ttf") that `@react-pdf/font` — seeing
// no URL scheme — hands straight to `fontkit.open()` as a filesystem path,
// which then fails since it isn't one. Mocking the import to the real
// absolute path makes that same fontkit.open() call succeed here, without
// changing how `CoverLetterDocument.tsx` imports it for the real build.
vi.mock("@/assets/fonts/Inter-Regular.ttf", () => ({
  default: path.resolve(__dirname, "../src/assets/fonts/Inter-Regular.ttf"),
}));

const { renderCoverLetterPdf } = await import("@/features/pdf/export");

/**
 * Reported live: Stepstone rejected an uploaded cover letter with "Datei
 * ist zu klein. Sie muss größer als 8KB sein." — the PDF was under 3 KB
 * because `CoverLetterDocument` used the unembedded "Helvetica" standard
 * font (no font program in the file at all, just text-drawing operators).
 * Embedding a real font (Inter) is what fixed it — react-pdf subsets it to
 * only the glyphs actually used, so this locks in that a realistic letter
 * clears that threshold with real margin, not by coincidence.
 */
describe("renderCoverLetterPdf", () => {
  it("produces a PDF safely over Stepstone's 8 KB minimum for a realistic letter", async () => {
    const paragraphs = [
      "Sehr geehrte Damen und Herren,",
      "mit großem Interesse bewerbe ich mich auf die ausgeschriebene Stelle als Senior Software Engineer bei der Acme GmbH. Mit über fünf Jahren Erfahrung in der Entwicklung skalierbarer Backend-Systeme bin ich überzeugt, einen wertvollen Beitrag zu Ihrem Team leisten zu können.",
      "In meiner aktuellen Position habe ich die Neugestaltung einer Such-Indexierungs-Pipeline geleitet, wodurch die Latenzzeit um 40 % reduziert wurde.",
      "Vielen Dank für Ihre Zeit und Berücksichtigung.",
      "Mit freundlichen Grüßen,\nJana Müller",
    ].join("\n\n");

    const file = await renderCoverLetterPdf(paragraphs, "Cover Letter.pdf");
    expect(file.type).toBe("application/pdf");
    expect(file.size).toBeGreaterThan(8 * 1024);
  });

  it("still clears 8 KB even for a pathologically short letter", async () => {
    const paragraphs = ["Dear Sir or Madam,", "I am applying for the open position.", "Best regards,\nA"].join(
      "\n\n",
    );

    const file = await renderCoverLetterPdf(paragraphs, "Cover Letter.pdf");
    expect(file.size).toBeGreaterThan(8 * 1024);
  });
});
