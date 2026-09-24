import { MARK_CLOSE, MARK_OPEN } from "./template";

/**
 * The small, line-oriented Markdown subset a CV template is written in —
 * rendered by both the PDF document (`features/pdf/CvDocument.tsx`) and the
 * Side Panel preview, so what the user previews is exactly what exports.
 *
 *   # Name                     → title
 *   ## Experience              → section heading (with a rule under it)
 *   ### Role || 2021 – now     → entry heading; `||` pushes the rest to the right edge
 *   - bullet / * bullet        → bullet (indent 2+ spaces for a nested one)
 *   ---                        → horizontal rule
 *   any other line             → one line of text (also accepts `left || right`)
 *   blank line                 → small vertical gap
 *
 * Inline: `**bold**`, `*italic*`, `[text](https://…)`, and `\*` for a literal asterisk.
 */

export interface CvSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  /** Came from a `{{placeholder}}` substitution — highlighted in the preview only. */
  mark: boolean;
  link?: string;
}

export type CvBlock =
  | { type: "heading"; level: 1 | 2 | 3; left: CvSpan[]; right: CvSpan[] | null }
  | { type: "bullet"; depth: number; left: CvSpan[]; right: CvSpan[] | null }
  | { type: "line"; left: CvSpan[]; right: CvSpan[] | null }
  | { type: "rule" }
  | { type: "gap" };

interface InlineState {
  bold: boolean;
  italic: boolean;
  mark: boolean;
}

const LINK_RE = /^\[([^\]]*)\]\(([^)\s]+)\)/;

function parseInlineInto(src: string, state: InlineState, spans: CvSpan[], link?: string): void {
  let buffer = "";
  const flush = () => {
    if (buffer) spans.push({ text: buffer, bold: state.bold, italic: state.italic, mark: state.mark, link });
    buffer = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === MARK_OPEN || ch === MARK_CLOSE) {
      flush();
      state.mark = ch === MARK_OPEN;
      i += 1;
    } else if (ch === "\\" && i + 1 < src.length) {
      buffer += src[i + 1];
      i += 2;
    } else if (src.startsWith("**", i)) {
      flush();
      state.bold = !state.bold;
      i += 2;
    } else if (ch === "*") {
      flush();
      state.italic = !state.italic;
      i += 1;
    } else if (ch === "[" && !link) {
      const match = LINK_RE.exec(src.slice(i));
      if (match) {
        flush();
        parseInlineInto(match[1], state, spans, match[2].replace(/[]/g, ""));
        i += match[0].length;
      } else {
        buffer += ch;
        i += 1;
      }
    } else {
      buffer += ch;
      i += 1;
    }
  }
  flush();
}

export function parseInline(src: string, carry?: InlineState): CvSpan[] {
  const spans: CvSpan[] = [];
  parseInlineInto(src, carry ?? { bold: false, italic: false, mark: false }, spans);
  return spans;
}

/** `left || right` → two span lists sharing one inline state (so `**a || b**` stays bold on both sides). */
function parseSides(src: string): { left: CvSpan[]; right: CvSpan[] | null } {
  const state: InlineState = { bold: false, italic: false, mark: false };
  const split = src.indexOf(" || ");
  if (split === -1) return { left: parseInline(src.trim(), state), right: null };
  const left = parseInline(src.slice(0, split).trim(), state);
  const right = parseInline(src.slice(split + 4).trim(), state);
  return { left, right };
}

const LEADING_MARKS_RE = /^([]*)(\s*(?:#{1,3}\s+|[-*•]\s+))/;

export function parseCvMarkdown(content: string): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const rawLine of content.replace(/\r\n?/g, "\n").split("\n")) {
    // A substituted value can start a line with its highlight mark *before*
    // the block syntax (`{{bullets}}` whose option is "- Built …") — move
    // the mark after it so "- " is still recognized as a bullet.
    const line = rawLine.replace(LEADING_MARKS_RE, "$2$1");
    const bare = line.replace(/[]/g, "");

    if (!bare.trim()) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "gap") blocks.push({ type: "gap" });
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(bare)) {
      blocks.push({ type: "rule" });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line.trimStart());
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, ...parseSides(heading[2]) });
      continue;
    }
    const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.min(2, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2));
      blocks.push({ type: "bullet", depth, ...parseSides(bullet[2]) });
      continue;
    }
    blocks.push({ type: "line", ...parseSides(line) });
  }
  while (blocks.length > 0 && blocks[blocks.length - 1].type === "gap") blocks.pop();
  return blocks;
}

/**
 * Preview blocks for a Word template's extracted text: one line per
 * paragraph, no Markdown interpretation (a literal `*` or `#` in the CV is
 * just text), only the substitution highlights. Tabs — Word's column
 * alignment, e.g. "Address:<tab>Berlin" — collapse to a wider gap.
 */
export function parsePlainText(content: string): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const line of content.split("\n")) {
    if (!line.replace(/[\uE000\uE001]/g, "").trim()) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "gap") blocks.push({ type: "gap" });
      continue;
    }
    const spans: CvSpan[] = [];
    let mark = false;
    for (const part of line.replace(/\t+/g, "   ").split(/([\uE000\uE001])/)) {
      if (part === MARK_OPEN || part === MARK_CLOSE) mark = part === MARK_OPEN;
      else if (part) spans.push({ text: part, bold: false, italic: false, mark });
    }
    blocks.push({ type: "line", left: spans, right: null });
  }
  while (blocks.length > 0 && blocks[blocks.length - 1].type === "gap") blocks.pop();
  return blocks;
}

/** The syntax reference shown in the template editor and given to the AI that converts a plain CV into a template. */
export const CV_MARKDOWN_SYNTAX = `# Full Name                  → title (first line)
## Section                    → section heading
### Role, Company || 2021 – now  → entry heading, text after " || " is right-aligned
- bullet point                (indent 2 spaces for a nested one)
---                           → horizontal rule
plain line                    → one line of text (also accepts "left || right")
(blank line)                  → small gap
**bold**  *italic*  [label](https://…)  \\*literal asterisk
{{variable}}                  → replaced per job posting`;
