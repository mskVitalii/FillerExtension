import { MARK_CLOSE, MARK_OPEN } from "./template";

/** A run of CV text for the Side Panel preview. */
export interface CvSpan {
  text: string;
  /** Came from a `{{placeholder}}` substitution — highlighted. */
  mark: boolean;
}

export type CvBlock = { type: "line"; spans: CvSpan[] } | { type: "gap" };

/**
 * Preview blocks for a CV's extracted text: one line per line, no markup
 * interpretation (a literal `*` or `#` in the CV is just text), only the
 * substitution highlights. Tabs — Word's column alignment, e.g.
 * "Address:<tab>Berlin" — collapse to a wider gap.
 */
export function parsePlainText(content: string): CvBlock[] {
  const blocks: CvBlock[] = [];
  for (const line of content.split("\n")) {
    if (!line.replace(/[]/g, "").trim()) {
      if (blocks.length > 0 && blocks[blocks.length - 1].type !== "gap") blocks.push({ type: "gap" });
      continue;
    }
    const spans: CvSpan[] = [];
    let mark = false;
    for (const part of line.replace(/\t+/g, "   ").split(/([])/)) {
      if (part === MARK_OPEN || part === MARK_CLOSE) mark = part === MARK_OPEN;
      else if (part) spans.push({ text: part, mark });
    }
    blocks.push({ type: "line", spans });
  }
  while (blocks.length > 0 && blocks[blocks.length - 1].type === "gap") blocks.pop();
  return blocks;
}
