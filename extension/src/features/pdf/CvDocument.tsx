import { Document, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { CvBlock, CvSpan } from "@/features/cv-template/markdown";
import { PDF_FONT_FAMILY } from "./fonts";

const MUTED = "#555555";
const ACCENT = "#1f4e79";

const styles = StyleSheet.create({
  page: { paddingVertical: 36, paddingHorizontal: 42, fontSize: 10, lineHeight: 1.4, fontFamily: PDF_FONT_FAMILY },
  row: { flexDirection: "row", justifyContent: "space-between" },
  left: { flexGrow: 1, flexShrink: 1 },
  right: { flexShrink: 0, marginLeft: 12, color: MUTED, fontWeight: 400 },
  h1: { fontSize: 20, fontWeight: 700, lineHeight: 1.2, marginBottom: 2 },
  h2: {
    fontSize: 11.5,
    fontWeight: 700,
    color: ACCENT,
    marginTop: 8,
    marginBottom: 4,
    paddingBottom: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: "#b8c4d0",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  h3: { fontSize: 10.5, fontWeight: 700, marginTop: 3 },
  bullet: { flexDirection: "row", marginTop: 1 },
  bulletGlyph: { width: 10 },
  rule: { borderBottomWidth: 0.75, borderBottomColor: "#b8c4d0", marginVertical: 5 },
  gap: { height: 5 },
  link: { color: ACCENT, textDecoration: "none" },
});

function spanStyle(span: CvSpan): Style {
  return {
    ...(span.bold ? { fontWeight: 700 } : {}),
    ...(span.italic ? { fontStyle: "italic" } : {}),
  };
}

function Spans({ spans }: { spans: CvSpan[] }) {
  return (
    <>
      {spans.map((span, i) =>
        span.link ? (
          <Link key={i} src={span.link} style={[styles.link, spanStyle(span)]}>
            {span.text}
          </Link>
        ) : (
          <Text key={i} style={spanStyle(span)}>
            {span.text}
          </Text>
        ),
      )}
    </>
  );
}

/** One line, optionally split `left || right` with the right part pinned to the right edge (dates, locations). */
function Line({ left, right, style }: { left: CvSpan[]; right: CvSpan[] | null; style?: Style }) {
  if (!right) {
    return (
      <Text style={style}>
        <Spans spans={left} />
      </Text>
    );
  }
  return (
    <View style={[styles.row, style ?? {}]} wrap={false}>
      <Text style={styles.left}>
        <Spans spans={left} />
      </Text>
      <Text style={styles.right}>
        <Spans spans={right} />
      </Text>
    </View>
  );
}

function Block({ block }: { block: CvBlock }) {
  switch (block.type) {
    case "gap":
      return <View style={styles.gap} />;
    case "rule":
      return <View style={styles.rule} />;
    case "heading": {
      const style = block.level === 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3;
      // Keeps a heading from being stranded at the bottom of a page, away from its first entry.
      return (
        <View minPresenceAhead={28}>
          <Line left={block.left} right={block.right} style={style} />
        </View>
      );
    }
    case "bullet":
      return (
        <View style={[styles.bullet, { paddingLeft: block.depth * 12 }]}>
          <Text style={styles.bulletGlyph}>{block.depth > 0 ? "–" : "•"}</Text>
          <View style={styles.left}>
            <Line left={block.left} right={block.right} />
          </View>
        </View>
      );
    case "line":
      return <Line left={block.left} right={block.right} />;
  }
}

/** Single-column, text-first layout (real text, no images/tables) so ATS parsers read it cleanly. */
export function CvDocument({ blocks, title }: { blocks: CvBlock[]; title: string }) {
  return (
    <Document title={title}>
      <Page size="A4" style={styles.page}>
        {blocks.map((block, index) => (
          <Block key={index} block={block} />
        ))}
      </Page>
    </Document>
  );
}
