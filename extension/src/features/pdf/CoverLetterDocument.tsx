import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, lineHeight: 1.5, fontFamily: "Helvetica" },
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
