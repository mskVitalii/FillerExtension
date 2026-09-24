import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * Word (.docx) CV templates: the user types `{{placeholders}}` into their own
 * CV in Word, and only the text of those placeholders is ever rewritten —
 * layout, fonts, photo, tables, numbering and every other part of the
 * package pass through byte-for-byte. That's the whole point of this path
 * versus the Markdown one: no in-browser renderer reproduces a real Word
 * layout (docx-preview, tried against a real CV, lost the fonts, the
 * Symbol-font bullets and the photo placement).
 */

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const XML_NS = "http://www.w3.org/XML/1998/namespace";
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

/** Main body plus headers/footers — anywhere a user might reasonably type a placeholder. */
export function isTextPart(path: string): boolean {
  return /^word\/(document|header\d*|footer\d*)\.xml$/.test(path);
}

function partOrder(path: string): number {
  return path === "word/document.xml" ? 1 : path.startsWith("word/header") ? 0 : 2;
}

export function parseXml(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) throw new Error("The Word file's XML couldn't be parsed.");
  return doc;
}

/** `XMLSerializer` drops the `<?xml … standalone="yes"?>` declaration Word writes; put the original back. */
export function serializeXml(doc: Document, original: string): string {
  const body = new XMLSerializer().serializeToString(doc);
  const declaration = /^<\?xml[^>]*\?>/.exec(original)?.[0];
  return declaration && !body.startsWith("<?xml") ? `${declaration}\r\n${body}` : body;
}

function owningParagraph(node: Node): Element | null {
  let current = node.parentNode;
  while (current) {
    if (current.nodeType === 1 && (current as Element).localName === "p" && (current as Element).namespaceURI === W_NS) {
      return current as Element;
    }
    current = current.parentNode;
  }
  return null;
}

/**
 * The `<w:t>` text nodes that belong to `paragraph` itself, in document
 * order — excluding ones inside a nested paragraph (text boxes), which get
 * their own pass. Word splits typed text into many runs (spell-check marks,
 * revision ids, a formatting change mid-word), so `{{city}}` can easily be
 * `{{` + `city` + `}}` across three of these.
 */
function paragraphTextNodes(paragraph: Element): Element[] {
  return Array.from(paragraph.getElementsByTagNameNS(W_NS, "t")).filter((t) => owningParagraph(t) === paragraph);
}

/** Visible text of a paragraph for reading: `<w:t>` text, `<w:tab/>` as a tab, `<w:br/>`/`<w:cr/>` as a line break. */
function paragraphReadText(paragraph: Element): string {
  let text = "";
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (child.namespaceURI === W_NS && child.localName === "p") continue; // nested (text box) paragraph
      if (child.namespaceURI === W_NS && child.localName === "t") text += child.textContent ?? "";
      else if (child.namespaceURI === W_NS && child.localName === "tab") text += "\t";
      else if (child.namespaceURI === W_NS && (child.localName === "br" || child.localName === "cr")) text += "\n";
      else walk(child);
    }
  };
  walk(paragraph);
  return text;
}

function paragraphs(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagNameNS(W_NS, "p"));
}

function setText(t: Element, text: string): void {
  t.textContent = text;
  t.setAttributeNS(XML_NS, "xml:space", "preserve");
}

/** A value with line breaks becomes `text <w:br/> text` inside the same run, keeping that run's formatting. */
function expandLineBreaks(t: Element): void {
  const lines = (t.textContent ?? "").split("\n");
  if (lines.length < 2) return;
  const doc = t.ownerDocument;
  setText(t, lines[0]);
  let anchor: Element = t;
  for (const line of lines.slice(1)) {
    const br = doc.createElementNS(W_NS, "w:br");
    const next = doc.createElementNS(W_NS, "w:t");
    setText(next, line);
    anchor.after(br, next);
    anchor = next;
  }
}

function fillParagraph(paragraph: Element, values: Record<string, string>): void {
  const nodes = paragraphTextNodes(paragraph);
  const full = nodes.map((t) => t.textContent ?? "").join("");
  const matches = [...full.matchAll(PLACEHOLDER_RE)];
  if (matches.length === 0) return;

  const touched = new Set<Element>();
  // Right to left: replacing a later match never shifts an earlier match's offsets.
  for (const match of matches.reverse()) {
    const start = match.index;
    const end = start + match[0].length;
    const value = values[match[1]] ?? "";
    let offset = 0;
    let first = true;
    for (const t of nodes) {
      const text = t.textContent ?? "";
      const nodeStart = offset;
      const nodeEnd = offset + text.length;
      offset = nodeEnd;
      if (nodeEnd <= start || nodeStart >= end) continue;
      const cutFrom = Math.max(start, nodeStart) - nodeStart;
      const cutTo = Math.min(end, nodeEnd) - nodeStart;
      // The value lands in the run where `{{` starts, so it takes that run's formatting.
      setText(t, text.slice(0, cutFrom) + (first ? value : "") + text.slice(cutTo));
      touched.add(t);
      first = false;
    }
  }
  for (const t of touched) expandLineBreaks(t);
}

export function readParts(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new Error("This doesn't look like a .docx file.");
  }
}

/**
 * Plain text of the document, one line per paragraph (headers first, then
 * the body, then footers) — what placeholder detection, the AI and the Side
 * Panel preview work from. Table cells come out as their own lines.
 */
export function readDocxText(bytes: Uint8Array): string {
  const parts = readParts(bytes);
  if (!parts["word/document.xml"]) throw new Error("This .docx has no word/document.xml.");
  return Object.keys(parts)
    .filter(isTextPart)
    .sort((a, b) => partOrder(a) - partOrder(b))
    .flatMap((path) =>
      paragraphs(parseXml(strFromU8(parts[path]))).map(paragraphReadText),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Returns a new .docx with every `{{placeholder}}` replaced by `values[name]` (empty when missing). */
export function fillDocx(bytes: Uint8Array, values: Record<string, string>): Uint8Array {
  const parts = readParts(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(parts)) {
    if (!isTextPart(path)) {
      out[path] = data;
      continue;
    }
    const xml = strFromU8(data);
    // Tags stripped, so a `{` + `{` split across two runs still counts; untouched parts stay byte-identical.
    if (!xml.replace(/<[^>]+>/g, "").includes("{{")) {
      out[path] = data;
      continue;
    }
    const doc = parseXml(xml);
    for (const paragraph of paragraphs(doc)) fillParagraph(paragraph, values);
    out[path] = strToU8(serializeXml(doc, xml));
  }
  // Entry order is preserved from the source (`[Content_Types].xml` first, as Word writes it).
  return zipSync(out, { level: 6 });
}
