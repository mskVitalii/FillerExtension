import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFFont,
} from "pdf-lib";
import { Encodings, Font as StandardFontMetrics, FontNames } from "@pdf-lib/standard-fonts";

/**
 * Fills `{{placeholders}}` inside the user's own PDF CV, in place: the file
 * is copied object for object and only the text-showing operators that draw
 * a placeholder are rewritten. Layout, photo, links and fonts stay as they
 * were, because nothing is rebuilt.
 *
 * The replacement is drawn with the placeholder's own embedded font whenever
 * that font's subset has every glyph the value needs. A PDF embeds only the
 * glyphs the document used, so "used somewhere with this font" (or listed in
 * a Type1 font's CharSet) is the test. Otherwise the whole value is drawn
 * with a stand-in: a Standard 14 font of the same kind (serif / sans / mono,
 * bold, italic), or Inter for text outside WinAnsi (e.g. Cyrillic).
 *
 * Text after the placeholder on the same line moves with the new width when
 * the producer drew it in the same text flow (LaTeX, Word and Chrome mostly
 * do). Text positioned on its own (a right-aligned date) stays where it was.
 */

// ---------------------------------------------------------------------------
// Content stream lexer
// ---------------------------------------------------------------------------

class Name {
  constructor(readonly value: string) {}
}

type Operand = number | boolean | null | Name | Uint8Array | Operand[] | Map<string, Operand>;

interface Op {
  op: string;
  args: Operand[];
  /** Byte range of the whole operation (operands included) in the decoded stream. */
  start: number;
  end: number;
}

const WHITESPACE = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITERS = new Set("()<>[]{}/%".split("").map((c) => c.charCodeAt(0)));

function isRegular(code: number): boolean {
  return !WHITESPACE.has(code) && !DELIMITERS.has(code);
}

type Token = { kind: "value"; value: Operand; start: number } | { kind: "op"; name: string; start: number; end: number };

class Lexer {
  pos = 0;
  constructor(readonly src: string) {}

  private code(at = this.pos): number {
    return this.src.charCodeAt(at);
  }

  skipSpace() {
    while (this.pos < this.src.length) {
      const c = this.code();
      if (WHITESPACE.has(c)) this.pos++;
      else if (c === 0x25 /* % */) {
        while (this.pos < this.src.length && this.code() !== 0x0a && this.code() !== 0x0d) this.pos++;
      } else break;
    }
  }

  next(): Token | null {
    this.skipSpace();
    if (this.pos >= this.src.length) return null;
    const start = this.pos;
    const c = this.src[this.pos];
    if (c === "(" || c === "<" || c === "[" || c === "/" || /[\d+\-.]/.test(c)) {
      return { kind: "value", value: this.readValue(), start };
    }
    if (c === "]" || c === ")" || c === ">" || c === "{" || c === "}") {
      // Stray delimiter — skip it rather than stall.
      this.pos++;
      return this.next();
    }
    const word = this.readWord();
    if (word === "true" || word === "false") return { kind: "value", value: word === "true", start };
    if (word === "null") return { kind: "value", value: null, start };
    return { kind: "op", name: word, start, end: this.pos };
  }

  private readWord(): string {
    const start = this.pos;
    while (this.pos < this.src.length && isRegular(this.code())) this.pos++;
    if (this.pos === start) this.pos++;
    return this.src.slice(start, this.pos);
  }

  readValue(): Operand {
    this.skipSpace();
    const c = this.src[this.pos];
    if (c === "(") return this.readLiteral();
    if (c === "<") return this.src[this.pos + 1] === "<" ? this.readDict() : this.readHex();
    if (c === "[") {
      this.pos++;
      const items: Operand[] = [];
      for (;;) {
        this.skipSpace();
        if (this.pos >= this.src.length) break;
        if (this.src[this.pos] === "]") {
          this.pos++;
          break;
        }
        items.push(this.readValue());
      }
      return items;
    }
    if (c === "/") {
      this.pos++;
      const raw = this.readRaw();
      return new Name(raw.replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
    }
    const word = this.readWord();
    if (word === "true" || word === "false") return word === "true";
    const number = Number(word);
    return Number.isFinite(number) ? number : null;
  }

  private readRaw(): string {
    const start = this.pos;
    while (this.pos < this.src.length && isRegular(this.code())) this.pos++;
    return this.src.slice(start, this.pos);
  }

  private readLiteral(): Uint8Array {
    this.pos++;
    const bytes: number[] = [];
    let depth = 1;
    while (this.pos < this.src.length) {
      const c = this.code(this.pos++);
      if (c === 0x5c /* \ */) {
        const n = this.src[this.pos++];
        if (n === "n") bytes.push(0x0a);
        else if (n === "r") bytes.push(0x0d);
        else if (n === "t") bytes.push(0x09);
        else if (n === "b") bytes.push(0x08);
        else if (n === "f") bytes.push(0x0c);
        else if (n === "\r") {
          if (this.src[this.pos] === "\n") this.pos++;
        } else if (n === "\n") {
          // Line continuation.
        } else if (n !== undefined && n >= "0" && n <= "7") {
          let octal = n;
          while (octal.length < 3 && /[0-7]/.test(this.src[this.pos] ?? "")) octal += this.src[this.pos++];
          bytes.push(parseInt(octal, 8) & 0xff);
        } else if (n !== undefined) bytes.push(n.charCodeAt(0));
      } else if (c === 0x28 /* ( */) {
        depth++;
        bytes.push(c);
      } else if (c === 0x29 /* ) */) {
        if (--depth === 0) break;
        bytes.push(c);
      } else bytes.push(c);
    }
    return Uint8Array.from(bytes);
  }

  private readHex(): Uint8Array {
    this.pos++;
    const end = this.src.indexOf(">", this.pos);
    const stop = end === -1 ? this.src.length : end;
    let hex = this.src.slice(this.pos, stop).replace(/[^0-9a-fA-F]/g, "");
    this.pos = stop + 1;
    if (hex.length % 2) hex += "0";
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return bytes;
  }

  private readDict(): Map<string, Operand> {
    this.pos += 2;
    const dict = new Map<string, Operand>();
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.src.length) break;
      if (this.src.startsWith(">>", this.pos)) {
        this.pos += 2;
        break;
      }
      const key = this.readValue();
      const value = this.readValue();
      if (key instanceof Name) dict.set(key.value, value);
    }
    return dict;
  }

  /** Skips an inline image's binary data (after `ID`) up to and including its `EI`. */
  skipInlineImage() {
    this.pos++; // the single whitespace after ID
    const re = /[\s]EI(?=[\s]|$)/g;
    re.lastIndex = this.pos;
    const match = re.exec(this.src);
    this.pos = match ? match.index + match[0].length : this.src.length;
  }
}

function parseContent(src: string): Op[] {
  const lexer = new Lexer(src);
  const ops: Op[] = [];
  let args: Operand[] = [];
  let argsStart = -1;
  for (;;) {
    const token = lexer.next();
    if (!token) break;
    if (token.kind === "value") {
      if (argsStart === -1) argsStart = token.start;
      args.push(token.value);
      continue;
    }
    const start = argsStart === -1 ? token.start : argsStart;
    if (token.name === "BI") {
      // Inline image: dictionary entries up to ID, then raw bytes up to EI.
      for (;;) {
        const inner = lexer.next();
        if (!inner) break;
        if (inner.kind === "op" && inner.name === "ID") {
          lexer.skipInlineImage();
          break;
        }
      }
      ops.push({ op: "BI", args: [], start, end: lexer.pos });
    } else {
      ops.push({ op: token.name, args, start, end: token.end });
    }
    args = [];
    argsStart = -1;
  }
  return ops;
}

// ---------------------------------------------------------------------------
// Fonts: code ↔ Unicode, and which glyphs the embedded subset actually has
// ---------------------------------------------------------------------------

/** Glyph name → Unicode for WinAnsi's repertoire plus the usual extras. */
const GLYPH_TO_UNICODE = new Map<string, string>();
/** WinAnsi code → glyph name. */
const WIN_ANSI_NAMES: (string | undefined)[] = new Array(256);
for (const codePoint of Encodings.WinAnsi.supportedCodePoints) {
  const { code, name } = Encodings.WinAnsi.encodeUnicodeCodePoint(codePoint);
  if (!GLYPH_TO_UNICODE.has(name)) GLYPH_TO_UNICODE.set(name, String.fromCodePoint(codePoint));
  if (code < 256 && !WIN_ANSI_NAMES[code]) WIN_ANSI_NAMES[code] = name;
}
for (const [name, text] of Object.entries({
  fi: "fi",
  fl: "fl",
  ff: "ff",
  ffi: "ffi",
  ffl: "ffl",
  dotlessi: "ı",
  minus: "−",
  quoteleft: "‘",
  quoteright: "’",
  space: " ",
  nbspace: " ",
  hyphen: "-",
  sfthyphen: "­",
})) {
  GLYPH_TO_UNICODE.set(name, text);
}

/** StandardEncoding — the base for Type1 fonts without an explicit one — differs from WinAnsi in the ASCII range only here. */
const STANDARD_NAMES = [...WIN_ANSI_NAMES];
STANDARD_NAMES[0x27] = "quoteright";
STANDARD_NAMES[0x60] = "quoteleft";
for (let code = 0x80; code < 0x100; code++) STANDARD_NAMES[code] = undefined;

function glyphNameToUnicode(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const known = GLYPH_TO_UNICODE.get(name);
  if (known) return known;
  const uni = /^uni([0-9A-Fa-f]{4})$/.exec(name) ?? /^u([0-9A-Fa-f]{4,6})$/.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  if (name.length === 1) return name;
  return undefined;
}

function utf16(hex: string): string {
  let text = "";
  for (let i = 0; i + 4 <= hex.length; i += 4) text += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  if (hex.length === 2) text = String.fromCharCode(parseInt(hex, 16));
  return text;
}

function parseToUnicode(cmap: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      map.set(parseInt(pair[1], 16), utf16(pair[2]));
    }
  }
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(range[1], 16);
      const hi = Math.min(parseInt(range[2], 16), lo + 0xffff);
      if (range[3] !== undefined) {
        const base = utf16(range[3]);
        const prefix = base.slice(0, -1);
        const last = base.charCodeAt(base.length - 1);
        for (let code = lo; code <= hi; code++) map.set(code, prefix + String.fromCharCode(last + (code - lo)));
      } else {
        const items = [...range[4].matchAll(/<([0-9a-fA-F]*)>/g)].map((m) => utf16(m[1]));
        items.forEach((text, i) => map.set(lo + i, text));
      }
    }
  }
  return map;
}

interface FontStyle {
  serif: boolean;
  mono: boolean;
  bold: boolean;
  italic: boolean;
}

class FontInfo {
  readonly composite: boolean;
  /** False for an encoding we can't map (a non-Identity CMap) — nothing is matched or written in it. */
  readonly supported: boolean;
  readonly usedCodes = new Set<number>();
  /** Interword gaps a TeX-made PDF draws as TJ kerns instead of space glyphs — reused when the value has spaces. */
  readonly spaceKerns: number[] = [];
  readonly style: FontStyle;
  private readonly toUnicode: Map<number, string>;
  private readonly glyphNames: (string | undefined)[] = [];
  private readonly charSet: Set<string> | null = null;
  private readonly isType1: boolean;
  /** A Standard 14 font the viewer supplies — every glyph of its encoding is there. */
  private readonly unembedded: boolean = false;
  private readonly widths = new Map<number, number>();
  /** Width of a code missing from the widths table: DW for a CID font, MissingWidth otherwise. */
  private readonly defaultWidth: number = 0;
  /** An unembedded Standard 14 font written without a Widths array — its metrics come from the AFM data. */
  private readonly standardMetrics: StandardFontMetrics | null = null;
  private reverse: Map<string, number[]> | null = null;

  constructor(readonly dict: PDFDict) {
    const subtype = dict.lookup(PDFName.of("Subtype"));
    this.composite = subtype === PDFName.of("Type0");
    this.isType1 = subtype === PDFName.of("Type1") || subtype === PDFName.of("MMType1");
    const toUnicodeStream = dict.lookup(PDFName.of("ToUnicode"));
    this.toUnicode =
      toUnicodeStream instanceof PDFRawStream ? parseToUnicode(decodeStream(toUnicodeStream)) : new Map<number, string>();

    let descriptor = dict.lookup(PDFName.of("FontDescriptor"));
    if (this.composite) {
      const encoding = dict.lookup(PDFName.of("Encoding"));
      this.supported = encoding === PDFName.of("Identity-H") || encoding === PDFName.of("Identity-V");
      const descendants = dict.lookup(PDFName.of("DescendantFonts"));
      const cidFont = descendants instanceof PDFArray ? descendants.lookup(0) : undefined;
      if (cidFont instanceof PDFDict) {
        descriptor = cidFont.lookup(PDFName.of("FontDescriptor"));
        const dw = cidFont.lookup(PDFName.of("DW"));
        this.defaultWidth = dw instanceof PDFNumber ? dw.asNumber() : 1000;
        const w = cidFont.lookup(PDFName.of("W"));
        if (w instanceof PDFArray) this.readCidWidths(w);
      }
    } else {
      this.supported = true;
      this.glyphNames = this.readSimpleEncoding();
      const first = dict.lookup(PDFName.of("FirstChar"));
      const widths = dict.lookup(PDFName.of("Widths"));
      if (first instanceof PDFNumber && widths instanceof PDFArray) {
        for (let i = 0; i < widths.size(); i++) {
          const width = widths.lookup(i);
          if (width instanceof PDFNumber) this.widths.set(first.asNumber() + i, width.asNumber());
        }
      }
    }

    const baseFont = dict.lookup(PDFName.of("BaseFont"));
    const name = baseFont instanceof PDFName ? baseFont.decodeText() : "";
    let flags = 0;
    let weight = 0;
    if (!(descriptor instanceof PDFDict)) this.unembedded = !this.composite && subtype !== PDFName.of("Type3");
    if (descriptor instanceof PDFDict) {
      const flagsObj = descriptor.lookup(PDFName.of("Flags"));
      if (flagsObj instanceof PDFNumber) flags = flagsObj.asNumber();
      const missingWidth = descriptor.lookup(PDFName.of("MissingWidth"));
      if (!this.composite && missingWidth instanceof PDFNumber) this.defaultWidth = missingWidth.asNumber();
      const weightObj = descriptor.lookup(PDFName.of("FontWeight"));
      if (weightObj instanceof PDFNumber) weight = weightObj.asNumber();
      this.unembedded = !["FontFile", "FontFile2", "FontFile3"].some((key) => descriptor.has(PDFName.of(key)));
      const charSet = descriptor.lookup(PDFName.of("CharSet"));
      if (charSet instanceof PDFString || charSet instanceof PDFHexString) {
        this.charSet = new Set(charSet.decodeText().split("/").filter(Boolean));
      }
    }
    const bare = name.replace(/^[A-Z]{6}\+/, "");
    if (!this.composite && this.widths.size === 0 && (Object.values(FontNames) as string[]).includes(bare)) {
      this.standardMetrics = StandardFontMetrics.load(bare as FontNames);
    }
    this.style = {
      mono: Boolean(flags & 1) || /mono|courier|consol|code|lmtt|cmtt/i.test(bare),
      serif:
        Boolean(flags & 2) ||
        (/roman|times|serif|georgia|garamond|cambria|palatino|book|minion|charter|libertin|merriweather|baskerville|^lmr|^cmr/i.test(
          bare,
        ) &&
          !/sans/i.test(bare)),
      bold: weight >= 600 || Boolean(flags & 0x40000) || /bold|black|heavy|semibold|demi/i.test(bare),
      italic: Boolean(flags & 0x40) || /italic|oblique|-it\b/i.test(bare),
    };
  }

  private readSimpleEncoding(): (string | undefined)[] {
    const encoding = this.dict.lookup(PDFName.of("Encoding"));
    const baseName = encoding instanceof PDFName ? encoding : encoding instanceof PDFDict ? encoding.lookup(PDFName.of("BaseEncoding")) : undefined;
    const names = baseName === PDFName.of("WinAnsiEncoding") ? [...WIN_ANSI_NAMES] : [...STANDARD_NAMES];
    if (encoding instanceof PDFDict) {
      const differences = encoding.lookup(PDFName.of("Differences"));
      if (differences instanceof PDFArray) {
        let code = 0;
        for (let i = 0; i < differences.size(); i++) {
          const item = differences.lookup(i);
          if (item instanceof PDFNumber) code = item.asNumber();
          else if (item instanceof PDFName) names[code++] = item.decodeText();
        }
      }
    }
    return names;
  }

  private readCidWidths(w: PDFArray) {
    for (let i = 0; i < w.size(); ) {
      const first = w.lookup(i);
      const next = w.lookup(i + 1);
      if (!(first instanceof PDFNumber)) break;
      if (next instanceof PDFArray) {
        for (let j = 0; j < next.size(); j++) {
          const width = next.lookup(j);
          if (width instanceof PDFNumber) this.widths.set(first.asNumber() + j, width.asNumber());
        }
        i += 2;
      } else {
        const last = next instanceof PDFNumber ? next.asNumber() : first.asNumber();
        const width = w.lookup(i + 2);
        const value = width instanceof PDFNumber ? width.asNumber() : 0;
        for (let cid = first.asNumber(); cid <= last && cid - first.asNumber() < 0x10000; cid++) this.widths.set(cid, value);
        i += 3;
      }
    }
  }

  get bytesPerCode(): number {
    return this.composite ? 2 : 1;
  }

  /** Glyph width in thousandths of an em. */
  width(code: number): number {
    const width = this.widths.get(code);
    if (width !== undefined) return width;
    if (this.standardMetrics) {
      const name = this.glyphNames[code];
      return (name && this.standardMetrics.getWidthOfGlyph(name)) || 0;
    }
    return this.defaultWidth;
  }

  /** Splits a shown string into character codes. */
  codes(bytes: Uint8Array): { code: number; start: number; end: number }[] {
    const out: { code: number; start: number; end: number }[] = [];
    const step = this.bytesPerCode;
    for (let i = 0; i + step <= bytes.length; i += step) {
      out.push({ code: step === 2 ? (bytes[i] << 8) | bytes[i + 1] : bytes[i], start: i, end: i + step });
    }
    return out;
  }

  unicode(code: number): string {
    if (!this.supported) return "";
    const mapped = this.toUnicode.get(code);
    if (mapped !== undefined) return mapped;
    if (this.composite) return "";
    return glyphNameToUnicode(this.glyphNames[code]) ?? "";
  }

  /** Is the glyph for `code` really in the embedded subset (and does the font say how wide it is)? */
  private hasGlyph(code: number): boolean {
    if (this.usedCodes.has(code)) return true;
    if (this.unembedded) return true;
    if (this.isType1 && this.charSet) {
      const name = this.glyphNames[code];
      return Boolean(name && this.charSet.has(name) && (this.widths.get(code) ?? 0) > 0);
    }
    return false;
  }

  private codeFor(char: string): number | undefined {
    if (!this.reverse) {
      this.reverse = new Map();
      const candidates = new Set<number>([...this.usedCodes, ...this.toUnicode.keys()]);
      if (!this.composite) for (let code = 0; code < 256; code++) candidates.add(code);
      for (const code of candidates) {
        const text = this.unicode(code);
        if (!text) continue;
        const list = this.reverse.get(text) ?? [];
        list.push(code);
        this.reverse.set(text, list);
      }
    }
    return this.reverse.get(char)?.find((code) => this.hasGlyph(code));
  }

  /**
   * `text` as TJ array parts in this font — or null when a glyph is missing
   * from the subset. A space the font can't draw becomes a kern of the size
   * the document already uses between words.
   */
  encode(text: string): (Uint8Array | number)[] | null {
    if (!this.supported) return null;
    const parts: (Uint8Array | number)[] = [];
    let run: number[] = [];
    const flush = () => {
      if (run.length) parts.push(Uint8Array.from(run));
      run = [];
    };
    for (const char of text) {
      const code = this.codeFor(char);
      if (code === undefined) {
        if (!/\s/.test(char)) return null;
        flush();
        parts.push(this.spaceKern());
        continue;
      }
      if (this.composite) run.push(code >> 8, code & 0xff);
      else run.push(code);
    }
    flush();
    return parts;
  }

  private spaceKern(): number {
    if (this.spaceKerns.length === 0) return -333;
    const sorted = [...this.spaceKerns].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

function decodeStream(stream: PDFRawStream): string {
  const bytes = decodePDFRawStream(stream).decode();
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

function encodeLatin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

// ---------------------------------------------------------------------------
// Walking content streams
// ---------------------------------------------------------------------------

interface TextState {
  fontName: string;
  fontSize: number;
}

/** One content stream with the resources its names resolve against. */
interface StreamUnit {
  source: string;
  ops: Op[];
  resources: PDFDict | undefined;
  /** Writes the rewritten content back. */
  write: (content: string) => void;
}

/** The string operand(s) a text-showing operator draws, as indices into its args (TJ: into its array). */
function shownStrings(op: Op): { part: number; bytes: Uint8Array }[] {
  if (op.op === "Tj" || op.op === "'") {
    const arg = op.args[0];
    return arg instanceof Uint8Array ? [{ part: 0, bytes: arg }] : [];
  }
  if (op.op === '"') {
    const arg = op.args[2];
    return arg instanceof Uint8Array ? [{ part: 0, bytes: arg }] : [];
  }
  if (op.op === "TJ") {
    const arr = op.args[0];
    if (!Array.isArray(arr)) return [];
    return arr.flatMap((item, part) => (item instanceof Uint8Array ? [{ part, bytes: item }] : []));
  }
  return [];
}

function fontDictFor(resources: PDFDict | undefined, name: string): PDFDict | undefined {
  const fonts = resources?.lookup(PDFName.of("Font"));
  if (!(fonts instanceof PDFDict)) return undefined;
  const font = fonts.lookup(PDFName.of(name));
  return font instanceof PDFDict ? font : undefined;
}

interface ShownGlyph {
  opIndex: number;
  part: number;
  byteStart: number;
  byteEnd: number;
  font: FontInfo;
  state: TextState;
}

/**
 * Runs over one stream's ops, tracking the current font through q/Q, and
 * reports every glyph drawn. Form XObjects are separate units.
 */
function walkGlyphs(unit: StreamUnit, fontFor: (dict: PDFDict) => FontInfo, onGlyph: (glyph: ShownGlyph, text: string) => void, onKern?: (font: FontInfo, kern: number) => void) {
  let state: TextState = { fontName: "", fontSize: 0 };
  const stack: TextState[] = [];
  unit.ops.forEach((op, opIndex) => {
    if (op.op === "q") stack.push({ ...state });
    else if (op.op === "Q") state = stack.pop() ?? state;
    else if (op.op === "Tf") {
      const [name, size] = op.args;
      if (name instanceof Name) state = { fontName: name.value, fontSize: typeof size === "number" ? size : state.fontSize };
    } else {
      const strings = shownStrings(op);
      if (strings.length === 0) return;
      const dict = fontDictFor(unit.resources, state.fontName);
      if (!dict) return;
      const font = fontFor(dict);
      if (onKern && op.op === "TJ" && Array.isArray(op.args[0])) {
        for (const item of op.args[0]) if (typeof item === "number" && item <= -150 && item >= -700) onKern(font, item);
      }
      for (const { part, bytes } of strings) {
        for (const { code, start, end } of font.codes(bytes)) {
          onGlyph({ opIndex, part, byteStart: start, byteEnd: end, font, state }, font.unicode(code));
          font.usedCodes.add(code);
        }
      }
    }
  });
}

function collectUnits(doc: PDFDocument): StreamUnit[] {
  const units: StreamUnit[] = [];
  const seenForms = new Set<string>();

  const addForms = (resources: PDFDict | undefined) => {
    const xobjects = resources?.lookup(PDFName.of("XObject"));
    if (!(xobjects instanceof PDFDict)) return;
    for (const [, value] of xobjects.entries()) {
      if (!(value instanceof PDFRef) || seenForms.has(value.toString())) continue;
      const stream = doc.context.lookup(value);
      if (!(stream instanceof PDFRawStream) || stream.dict.lookup(PDFName.of("Subtype")) !== PDFName.of("Form")) continue;
      seenForms.add(value.toString());
      const formResources = stream.dict.lookup(PDFName.of("Resources"));
      const own = formResources instanceof PDFDict ? formResources : resources;
      const source = decodeStream(stream);
      units.push({
        source,
        ops: parseContent(source),
        resources: own,
        write: (content) => {
          const dict = stream.dict.clone(doc.context);
          dict.delete(PDFName.of("DecodeParms"));
          const next = doc.context.flateStream(encodeLatin1(content));
          for (const [key, entry] of dict.entries()) {
            if (key === PDFName.of("Filter") || key === PDFName.of("Length")) continue;
            next.dict.set(key, entry);
          }
          doc.context.assign(value, next);
        },
      });
      addForms(own);
    }
  };

  for (const page of doc.getPages()) {
    const resources = page.node.Resources();
    const contents = page.node.Contents();
    const streams: PDFRawStream[] = [];
    if (contents instanceof PDFArray) {
      for (let i = 0; i < contents.size(); i++) {
        const item = contents.lookup(i);
        if (item instanceof PDFRawStream) streams.push(item);
      }
    } else if (contents instanceof PDFRawStream) streams.push(contents);
    // Streams of one page may split mid-way between operators, never inside one — joined with a newline they parse as one.
    const source = streams.map(decodeStream).join("\n");
    units.push({
      source,
      ops: parseContent(source),
      resources,
      write: (content) => {
        const stream = doc.context.flateStream(encodeLatin1(content));
        page.node.set(PDFName.of("Contents"), doc.context.register(stream));
      },
    });
    addForms(resources);
  }
  return units;
}

// ---------------------------------------------------------------------------
// Rewriting
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

function hex(bytes: Uint8Array): string {
  return `<${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}>`;
}

function num(n: number): string {
  const rounded = Math.round(n * 10000) / 10000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pdfName(name: string): string {
  return `/${name.replace(/[^!-~]|[()<>[\]{}/%#]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, "0")}`)}`;
}

/** What a matched placeholder turns into at its first glyph. */
type Insertion =
  | { kind: "same-font"; parts: (Uint8Array | number)[] }
  | {
      kind: "fallback";
      resourceName: string;
      /** The value encoded for the stand-in font, ready to show. */
      shown: string;
      /** Advance at the current font size, before character spacing. */
      width: number;
      chars: number;
      state: TextState;
    };

interface OpEdit {
  /** `${part}:${byteStart}` of glyphs to drop. */
  deleted: Set<string>;
  inserts: Map<string, Insertion>;
}

/** A kern from the original operator, with its index there — the layout pass may resize it. */
interface Kern {
  kern: number;
  part: number;
}

type TjItem = Uint8Array | number | Kern;

type Segment =
  | { kind: "tj"; items: TjItem[] }
  | { kind: "raw"; insertion: Extract<Insertion, { kind: "fallback" }> };

function showItems(op: Op): Operand[] {
  if (op.op === "TJ") return Array.isArray(op.args[0]) ? op.args[0] : [];
  return [op.args[op.op === '"' ? 2 : 0] ?? new Uint8Array()];
}

/** A text-showing operator's content with some glyphs dropped and replacements spliced in. */
function editShowOp(op: Op, font: FontInfo, edit: OpEdit): Segment[] {
  const segments: Segment[] = [{ kind: "tj", items: [] }];
  const current = () => segments[segments.length - 1] as Extract<Segment, { kind: "tj" }>;
  // A kern between two dropped glyphs (inside "{{city}}") goes too; one next to a kept glyph — often an interword space — stays.
  let pending: Kern[] = [];
  let lastDeleted = false;
  let run: number[] = [];
  const flush = () => {
    if (run.length) current().items.push(Uint8Array.from(run));
    run = [];
  };
  showItems(op).forEach((item, part) => {
    if (typeof item === "number") {
      flush();
      if (lastDeleted) pending.push({ kern: item, part });
      else current().items.push({ kern: item, part });
      return;
    }
    if (!(item instanceof Uint8Array)) return;
    for (const { start, end } of font.codes(item)) {
      const key = `${part}:${start}`;
      const deleted = edit.deleted.has(key);
      if (!deleted && pending.length) current().items.push(...pending);
      pending = [];
      const insertion = edit.inserts.get(key);
      if (insertion) {
        flush();
        if (insertion.kind === "same-font") current().items.push(...insertion.parts);
        else segments.push({ kind: "raw", insertion }, { kind: "tj", items: [] });
      }
      lastDeleted = deleted;
      if (deleted) continue;
      for (let i = start; i < end; i++) run.push(item[i]);
    }
    flush();
  });
  current().items.push(...pending);
  return segments;
}

function serializeSegments(segments: Segment[]): string[] {
  const lines: string[] = [];
  for (const segment of segments) {
    if (segment.kind === "raw") {
      const { resourceName, shown, state } = segment.insertion;
      lines.push(`${pdfName(resourceName)} ${num(state.fontSize)} Tf ${shown} Tj ${pdfName(state.fontName)} ${num(state.fontSize)} Tf`);
    } else if (segment.items.length > 0) {
      const items = segment.items.map((item) => (item instanceof Uint8Array ? hex(item) : num(typeof item === "number" ? item : item.kern)));
      lines.push(`[${items.join(" ")}] TJ`);
    }
  }
  return lines;
}

/** Text state the layout pass needs to measure what a show operator advances. */
interface LayoutParams {
  fontName: string;
  fontSize: number;
  charSpacing: number;
  wordSpacing: number;
  hScale: number;
  leading: number;
}

function isKern(item: unknown): item is Kern {
  return typeof item === "object" && item !== null && "kern" in item;
}

function itemsAdvance(items: readonly (Operand | Kern)[], font: FontInfo, p: LayoutParams): number {
  let advance = 0;
  for (const item of items) {
    if (typeof item === "number") advance -= (item / 1000) * p.fontSize * p.hScale;
    else if (isKern(item)) advance -= (item.kern / 1000) * p.fontSize * p.hScale;
    else if (item instanceof Uint8Array) {
      for (const { code } of font.codes(item)) {
        const wordSpacing = font.bytesPerCode === 1 && code === 32 ? p.wordSpacing : 0;
        advance += ((font.width(code) / 1000) * p.fontSize + p.charSpacing + wordSpacing) * p.hScale;
      }
    }
  }
  return advance;
}

function segmentsAdvance(segments: Segment[], font: FontInfo, p: LayoutParams): number {
  let advance = 0;
  for (const segment of segments) {
    if (segment.kind === "tj") advance += itemsAdvance(segment.items, font, p);
    else advance += (segment.insertion.width + segment.insertion.chars * p.charSpacing) * p.hScale;
  }
  return advance;
}

/** A kern this wide (in ems) is layout glue — LaTeX's \\hfill, a tab stop — not spacing between words. */
const GLUE_EMS = 3;

/**
 * Lets wide kerns after an edit absorb the width change, so text aligned
 * across the line (a date after \\hfill) stays where it was. `shift` is how
 * far (user space) edits before this operator already moved the flow.
 * Resizes the kerns in `segments` in place; true when any changed.
 */
function absorbShift(
  segments: Segment[],
  oldItems: Operand[],
  font: FontInfo,
  p: LayoutParams,
  shift: number,
  scale: number,
): boolean {
  const em = p.fontSize * p.hScale;
  if (!em || !scale) return false;
  let changed = false;
  let newAdvance = 0;
  for (const segment of segments) {
    if (segment.kind === "raw") {
      newAdvance += (segment.insertion.width + segment.insertion.chars * p.charSpacing) * p.hScale;
      continue;
    }
    segment.items.forEach((item, index) => {
      if (isKern(item) && -item.kern >= GLUE_EMS * 1000) {
        const here = shift + scale * (newAdvance - itemsAdvance(oldItems.slice(0, item.part), font, p));
        if (Math.abs(here) > 1e-6) {
          const gap = (-item.kern / 1000) * em;
          const nextGap = Math.max(gap - here / scale, em);
          segment.items[index] = { kern: -(nextGap / em) * 1000, part: item.part };
          changed = true;
        }
      }
      newAdvance += itemsAdvance([segment.items[index]], font, p);
    });
  }
  return changed;
}

/**
 * Serializes the edited stream. Besides the rewritten show operators, this
 * replays the text layout to keep each line reading naturally: a chunk that
 * sits flush against edited text on the same baseline (Chrome and Word start
 * a new chunk with its own Td/Tm mid-line) moves by the width difference; a
 * chunk further away (a right-aligned date) stays put. Every positioning
 * operator after a shift is corrected so later lines don't inherit it.
 */
function rewriteUnit(unit: StreamUnit, fontFor: (dict: PDFDict) => FontInfo, edits: Map<number, OpEdit>): string {
  const replacements = new Map<number, string>();
  let p: LayoutParams = { fontName: "", fontSize: 0, charSpacing: 0, wordSpacing: 0, hScale: 1, leading: 0 };
  const stack: LayoutParams[] = [];
  let basis = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  let upright = true;
  let lineX = 0;
  let lineY = 0;
  let currentX = 0;
  /** How far (user space) our corrections have already moved the current line origin — a relative Td inherits it. */
  let lineShift = 0;
  /** The flow being laid out on one baseline: where its text originally ended, and how far edits moved that end. */
  let chain: { y: number; endX: number; shift: number } | null = null;

  /** Starts a new line at text-space (x, y); returns the user-space correction its positioning operator needs. */
  const position = (x: number, y: number, inherited: number): number => {
    const X = basis.e + basis.a * x;
    const Y = basis.f + basis.d * y;
    const em = Math.abs(p.fontSize * basis.a) || 1;
    const flush = chain !== null && upright && Math.abs(Y - chain.y) < 0.01 * em && Math.abs(X - chain.endX) <= 0.5 * em;
    const desired = flush && chain ? chain.shift : 0;
    lineX = x;
    lineY = y;
    currentX = x;
    chain = { y: Y, endX: X, shift: desired };
    lineShift = desired;
    return desired - inherited;
  };
  const shiftPrefix = (adjust: number) => (Math.abs(adjust) > 1e-6 && basis.a ? `${num(adjust / basis.a)} 0 Td\n` : "");

  unit.ops.forEach((op, opIndex) => {
    const a = op.args;
    const n = (i: number) => (typeof a[i] === "number" ? (a[i] as number) : 0);
    switch (op.op) {
      case "q":
        stack.push({ ...p });
        return;
      case "Q":
        p = stack.pop() ?? p;
        return;
      case "cm":
        chain = null;
        return;
      case "Tf":
        if (a[0] instanceof Name) p = { ...p, fontName: a[0].value, fontSize: n(1) };
        return;
      case "Tc":
        p = { ...p, charSpacing: n(0) };
        return;
      case "Tw":
        p = { ...p, wordSpacing: n(0) };
        return;
      case "Tz":
        p = { ...p, hScale: n(0) / 100 };
        return;
      case "TL":
        p = { ...p, leading: n(0) };
        return;
      case "BT":
        basis = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        upright = true;
        lineX = lineY = currentX = 0;
        lineShift = 0;
        return;
      case "Tm": {
        basis = { a: n(0), b: n(1), c: n(2), d: n(3), e: n(4), f: n(5) };
        upright = basis.b === 0 && basis.c === 0 && basis.a !== 0;
        const adjust = position(0, 0, 0);
        if (Math.abs(adjust) > 1e-6) {
          replacements.set(opIndex, `${[basis.a, basis.b, basis.c, basis.d, basis.e + adjust, basis.f].map(num).join(" ")} Tm`);
        }
        return;
      }
      case "Td":
      case "TD": {
        if (op.op === "TD") p = { ...p, leading: -n(1) };
        const adjust = position(lineX + n(0), lineY + n(1), lineShift);
        if (Math.abs(adjust) > 1e-6 && basis.a) replacements.set(opIndex, `${num(n(0) + adjust / basis.a)} ${num(n(1))} ${op.op}`);
        return;
      }
      case "T*": {
        const prefix = shiftPrefix(position(lineX, lineY - p.leading, lineShift));
        if (prefix) replacements.set(opIndex, `${prefix}T*`);
        return;
      }
    }

    if (op.op !== "Tj" && op.op !== "TJ" && op.op !== "'" && op.op !== '"') return;
    let prefix = "";
    if (op.op === '"') p = { ...p, wordSpacing: n(0), charSpacing: n(1) };
    if (op.op === "'" || op.op === '"') prefix = shiftPrefix(position(lineX, lineY - p.leading, lineShift));
    const dict = fontDictFor(unit.resources, p.fontName);
    const font = dict ? fontFor(dict) : null;
    const edit = edits.get(opIndex);
    if (!font) {
      if (prefix) replacements.set(opIndex, prefix + unit.source.slice(op.start, op.end));
      return;
    }
    if (!chain) {
      chain = { y: basis.f + basis.d * lineY, endX: basis.e + basis.a * currentX, shift: lineShift };
    }
    const flow: { y: number; endX: number; shift: number } = chain;
    const oldItems = showItems(op);
    const before = itemsAdvance(oldItems, font, p);
    currentX += before;
    flow.endX += basis.a * before;
    if (!edit && Math.abs(flow.shift) < 1e-6) {
      if (prefix) replacements.set(opIndex, prefix + unit.source.slice(op.start, op.end));
      return;
    }
    const segments: Segment[] = edit
      ? editShowOp(op, font, edit)
      : [{ kind: "tj", items: oldItems.map((item, part) => (typeof item === "number" ? { kern: item, part } : (item as TjItem))) }];
    const absorbed = absorbShift(segments, oldItems, font, p, flow.shift, basis.a);
    if (!edit && !absorbed) {
      if (prefix) replacements.set(opIndex, prefix + unit.source.slice(op.start, op.end));
      return;
    }
    flow.shift += basis.a * (segmentsAdvance(segments, font, p) - before);
    const lines = serializeSegments(segments);
    const head = op.op === '"' ? `${num(n(0))} Tw ${num(n(1))} Tc\nT*\n` : op.op === "'" ? "T*\n" : "";
    replacements.set(opIndex, prefix + head + lines.join("\n"));
  });

  let out = "";
  let cursor = 0;
  for (const opIndex of [...replacements.keys()].sort((x, y) => x - y)) {
    const op = unit.ops[opIndex];
    out += unit.source.slice(cursor, op.start);
    out += `\n${replacements.get(opIndex)}\n`;
    cursor = op.end;
  }
  return out + unit.source.slice(cursor);
}

type FallbackKey =
  | "sans"
  | "sans-bold"
  | "sans-italic"
  | "sans-bold-italic"
  | "serif"
  | "serif-bold"
  | "serif-italic"
  | "serif-bold-italic"
  | "mono"
  | "mono-bold"
  | "mono-italic"
  | "mono-bold-italic";

const STANDARD_FALLBACKS: Record<FallbackKey, StandardFonts> = {
  sans: StandardFonts.Helvetica,
  "sans-bold": StandardFonts.HelveticaBold,
  "sans-italic": StandardFonts.HelveticaOblique,
  "sans-bold-italic": StandardFonts.HelveticaBoldOblique,
  serif: StandardFonts.TimesRoman,
  "serif-bold": StandardFonts.TimesRomanBold,
  "serif-italic": StandardFonts.TimesRomanItalic,
  "serif-bold-italic": StandardFonts.TimesRomanBoldItalic,
  mono: StandardFonts.Courier,
  "mono-bold": StandardFonts.CourierBold,
  "mono-italic": StandardFonts.CourierOblique,
  "mono-bold-italic": StandardFonts.CourierBoldOblique,
};

function fallbackKey(style: FontStyle): FallbackKey {
  const family = style.mono ? "mono" : style.serif ? "serif" : "sans";
  const variant = [style.bold && "bold", style.italic && "italic"].filter(Boolean).join("-");
  return (variant ? `${family}-${variant}` : family) as FallbackKey;
}

/** Bytes of a TrueType font with wide Unicode coverage, for values the Standard 14 fonts can't show (their encoding is WinAnsi). */
export type UnicodeFontLoader = (style: { bold: boolean; italic: boolean }) => Promise<Uint8Array>;

export interface PdfFillResult {
  bytes: Uint8Array;
  /** Placeholders found in the PDF and filled. */
  filled: string[];
  /** Values given for placeholders the PDF's text layer doesn't contain (e.g. text turned into outlines) — nothing was changed for them. */
  notFound: string[];
  /** Placeholders whose value was drawn in a stand-in font because the CV's own font subset lacks a glyph it needs. */
  substitutedFont: string[];
}

/** A PDF shows one line of text per operator — a multi-line value is laid out on one line here. */
function oneLine(value: string): string {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function fontCache() {
  const fonts = new Map<PDFDict, FontInfo>();
  return (dict: PDFDict) => {
    let info = fonts.get(dict);
    if (!info) fonts.set(dict, (info = new FontInfo(dict)));
    return info;
  };
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    if (err instanceof Error && /encrypt/i.test(err.message)) {
      throw new Error("This PDF is password-protected or encrypted, so its text can't be edited. Export it again without protection.");
    }
    throw err;
  }
}

/** Decoded text of each content stream (page or form), glyphs concatenated in drawing order — what placeholders are matched against. */
export async function pdfStreamText(bytes: Uint8Array): Promise<string[]> {
  const doc = await loadPdf(bytes);
  const fontFor = fontCache();
  return collectUnits(doc).map((unit) => {
    let text = "";
    walkGlyphs(unit, fontFor, (_, glyphText) => {
      text += glyphText;
    });
    return text;
  });
}

/** Every `{{placeholder}}` drawn in the PDF, in reading (stream) order — independent of how a text extractor would space it. */
export async function listPdfPlaceholders(bytes: Uint8Array): Promise<string[]> {
  const names: string[] = [];
  for (const text of await pdfStreamText(bytes)) {
    for (const match of text.matchAll(PLACEHOLDER_RE)) if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * The PDF with every `{{name}}` replaced by `values[name]` (missing → empty).
 * `loadUnicodeFont` is only called when a value has characters outside
 * WinAnsi and the CV's own font can't draw them.
 */
export async function fillPdf(
  bytes: Uint8Array,
  values: Record<string, string>,
  options: { loadUnicodeFont?: UnicodeFontLoader } = {},
): Promise<PdfFillResult> {
  const doc = await loadPdf(bytes);
  const fontFor = fontCache();
  const units = collectUnits(doc);

  // Pass 1: which codes every font has drawn anywhere in the document — those glyphs are certainly in its subset.
  for (const unit of units) {
    walkGlyphs(
      unit,
      fontFor,
      () => undefined,
      (font, kern) => font.spaceKerns.push(kern),
    );
  }

  const embedded = new Map<string, PDFFont>();
  let fontkitRegistered = false;
  async function fallbackFont(style: FontStyle, text: string): Promise<{ font: PDFFont; shown: string }> {
    const key = fallbackKey(style);
    let standard = embedded.get(key);
    if (!standard) {
      standard = await doc.embedFont(STANDARD_FALLBACKS[key]);
      embedded.set(key, standard);
    }
    try {
      return { font: standard, shown: standard.encodeText(text).toString() };
    } catch {
      // Outside WinAnsi — needs a real Unicode font.
    }
    if (!options.loadUnicodeFont) throw new Error(`The CV's font can't show "${text}", and no Unicode font is available.`);
    const unicodeKey = `unicode-${style.bold ? "bold" : ""}-${style.italic ? "italic" : ""}`;
    let unicode = embedded.get(unicodeKey);
    if (!unicode) {
      if (!fontkitRegistered) {
        const { default: fontkit } = await import("@pdf-lib/fontkit");
        doc.registerFontkit(fontkit);
        fontkitRegistered = true;
      }
      unicode = await doc.embedFont(await options.loadUnicodeFont({ bold: style.bold, italic: style.italic }), { subset: true });
      embedded.set(unicodeKey, unicode);
    }
    return { font: unicode, shown: unicode.encodeText(text).toString() };
  }

  const resourceNames = new Map<PDFDict, Map<PDFFont, string>>();
  function registerFont(resources: PDFDict | undefined, font: PDFFont): string {
    if (!resources) throw new Error("A PDF page has no resources to add a font to.");
    let fontDict = resources.lookup(PDFName.of("Font"));
    if (!(fontDict instanceof PDFDict)) {
      fontDict = doc.context.obj({});
      resources.set(PDFName.of("Font"), fontDict as PDFDict);
    }
    const dict = fontDict as PDFDict;
    let names = resourceNames.get(dict);
    if (!names) resourceNames.set(dict, (names = new Map()));
    const known = names.get(font);
    if (known) return known;
    let index = 1;
    while (dict.has(PDFName.of(`FillerF${index}`))) index++;
    const name = `FillerF${index}`;
    dict.set(PDFName.of(name), font.ref);
    names.set(font, name);
    return name;
  }

  const filled = new Set<string>();
  const substituted = new Set<string>();

  // Pass 2: find placeholders in each stream's decoded text and rewrite the operators that draw them.
  for (const unit of units) {
    const glyphs: ShownGlyph[] = [];
    let text = "";
    const charToGlyph: number[] = [];
    walkGlyphs(unit, fontFor, (glyph, glyphText) => {
      glyphs.push(glyph);
      for (let i = 0; i < glyphText.length; i++) charToGlyph.push(glyphs.length - 1);
      text += glyphText;
    });

    const edits = new Map<number, OpEdit>();
    const editFor = (opIndex: number) => {
      let edit = edits.get(opIndex);
      if (!edit) edits.set(opIndex, (edit = { deleted: new Set(), inserts: new Map() }));
      return edit;
    };

    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      const name = match[1];
      const first = charToGlyph[match.index];
      const last = charToGlyph[match.index + match[0].length - 1];
      const anchor = glyphs[first];
      const value = oneLine(values[name] ?? "");
      const anchorKey = `${anchor.part}:${anchor.byteStart}`;
      if (value) {
        const parts = anchor.font.encode(value);
        if (parts) {
          editFor(anchor.opIndex).inserts.set(anchorKey, { kind: "same-font", parts });
        } else {
          const { font, shown } = await fallbackFont(anchor.font.style, value);
          editFor(anchor.opIndex).inserts.set(anchorKey, {
            kind: "fallback",
            resourceName: registerFont(unit.resources, font),
            shown,
            width: font.widthOfTextAtSize(value, anchor.state.fontSize),
            chars: [...value].length,
            state: anchor.state,
          });
          substituted.add(name);
        }
      }
      for (let g = first; g <= last; g++) editFor(glyphs[g].opIndex).deleted.add(`${glyphs[g].part}:${glyphs[g].byteStart}`);
      filled.add(name);
    }
    if (edits.size > 0) unit.write(rewriteUnit(unit, fontFor, edits));
  }

  const saved = await doc.save();
  return {
    bytes: saved,
    filled: [...filled],
    notFound: Object.keys(values).filter((name) => !filled.has(name)),
    substitutedFont: [...substituted],
  };
}
