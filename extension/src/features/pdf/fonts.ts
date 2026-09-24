import { Font } from "@react-pdf/renderer";
import interRegular from "@/assets/fonts/Inter-Regular.ttf";
import interBold from "@/assets/fonts/Inter-Bold.ttf";
import interItalic from "@/assets/fonts/Inter-Italic.ttf";

// `Font.register`'s built-in "Helvetica" is one of the 14 unembedded PDF
// Standard fonts — react-pdf just references it by name and relies on the
// viewer to have it, so the whole PDF is little more than raw text-drawing
// operators. A short cover letter came out under 3 KB, and at least one
// real ATS (Stepstone) rejects an upload below 8 KB outright ("Datei ist
// zu klein") — a heuristic aimed at catching corrupt/empty uploads, not
// short *text*, but it doesn't know the difference. Embedding a real font
// is what any actual word processor's PDF export does anyway (and fixes
// inconsistent glyph rendering across viewers as a side effect); react-pdf
// subsets it to only the glyphs actually used, so a realistic letter lands
// comfortably over the threshold (~12 KB) without the file being padded
// with anything but its own typography. Inter (OFL-licensed, full Latin
// Extended coverage — German umlauts/ß included) is registered once here,
// the moment a PDF document module is dynamically imported for an export.
// Bold/Italic are only fetched when a document actually uses them (the CV
// template's `**bold**`/`*italic*`); bold+italic falls back to Italic,
// since react-pdf resolves style before weight.
export const PDF_FONT_FAMILY = "Inter";

Font.register({
  family: PDF_FONT_FAMILY,
  fonts: [
    { src: interRegular },
    { src: interBold, fontWeight: 700 },
    { src: interItalic, fontStyle: "italic" },
  ],
});
