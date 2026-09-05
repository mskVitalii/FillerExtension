import { Document, Font, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import interRegular from "@/assets/fonts/Inter-Regular.ttf";

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
// the moment this module is dynamically imported for an export.
Font.register({ family: "Inter", src: interRegular });

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, lineHeight: 1.5, fontFamily: "Inter" },
  paragraph: { marginBottom: 10 },
});

interface CoverLetterDocumentProps {
  paragraphs: string[];
}

/** Plain, ATS-friendly single-page layout (spec section 17) — the letter's own words do the work. */
export function CoverLetterDocument({ paragraphs }: CoverLetterDocumentProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View>
          {paragraphs.map((paragraph, index) => (
            <Text key={index} style={styles.paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}
