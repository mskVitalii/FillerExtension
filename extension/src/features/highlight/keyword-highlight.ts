import type { JobKeyword } from "@/types/job";

/**
 * Highlights keywords in the live page's own text (spec_8 item 2) by
 * wrapping each match in a real `<span>` pair — a real DOM element is
 * needed for the chip's border/padding/radius (the non-mutating CSS Custom
 * Highlight API (`CSS.highlights`/`::highlight()`) only accepts a fixed
 * property allowlist — color, background-color, text-decoration*,
 * text-shadow, -webkit-text-stroke*, -webkit-text-fill-color — and silently
 * ignores border/padding/border-radius). Text is a solid tone, no gradient.
 *
 * Wrapping text nodes on an arbitrary third-party page — very possibly a
 * React/Vue SPA that owns and re-renders that same subtree — risks the page
 * clobbering our spans the next time it re-renders that region (reverting
 * to its own plain text). A `MutationObserver` on `document.body` detects
 * that and re-applies the highlight pass; the pass is idempotent (it skips
 * text already inside a highlight wrapper), so the observer settles back to
 * doing nothing once the DOM is stable rather than looping.
 *
 * Each keyword carries `matchesProfile` (classified by the same AI pass that
 * extracted it, against the applicant's own profile/CV/Personal Legend — see
 * `analyze-job-brief.ts`) — a skill the applicant already has renders in a
 * green/teal tone, a gap in their material renders in a rose tone, so the
 * highlight doubles as an at-a-glance fit check, not just "this word is
 * notable". Both tones stay dark/mid-saturation rather than pastel, and each
 * chip gets a matching 1px border, so the text stays legible pasted onto an
 * unpredictable third-party page background instead of washing out.
 */

const WRAPPER_CLASS = "filler-keyword-highlight";
const TEXT_CLASS = "filler-keyword-highlight__text";
const MATCH_CLASS = "filler-keyword-highlight--match";
const GAP_CLASS = "filler-keyword-highlight--gap";
const STYLE_ID = "filler-keyword-highlight-style";
// A common short keyword (e.g. "AI", "Go") could otherwise match hundreds of
// times across an unrelated page — cap total wrapped matches so this stays
// cheap and visually meaningful rather than painting the whole page.
const MAX_MATCHES = 300;
// Batches the flurry of mutation records a single SPA re-render produces
// into one reapplication pass instead of one per record.
const REAPPLY_DEBOUNCE_MS = 150;

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "TITLE", "SVG"]);

let activeKeywords: JobKeyword[] = [];
// Keyed by lowercased keyword text — the match regex is a literal alternation
// of `activeKeywords`' own text run case-insensitively, so whatever exec()
// returns is always one of them modulo case.
let matchByText: Map<string, boolean> = new Map();
let observer: MutationObserver | null = null;
let reapplyTimer: ReturnType<typeof setTimeout> | null = null;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(keywords: JobKeyword[]): RegExp {
  return new RegExp(`(?:${keywords.map((k) => escapeRegExp(k.text)).join("|")})`, "gi");
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .${WRAPPER_CLASS} {
      display: inline;
      box-decoration-break: clone;
      -webkit-box-decoration-break: clone;
      border-radius: 4px;
      padding: 0.05em 0.3em;
      border: 1px solid transparent;
    }
    .${TEXT_CLASS} {
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .${MATCH_CLASS} {
      background-color: rgba(5, 150, 105, 0.12);
      border-color: rgba(5, 150, 105, 0.38);
    }
    .${MATCH_CLASS} .${TEXT_CLASS} {
      color: #047857;
    }
    .${GAP_CLASS} {
      background-color: rgba(190, 18, 60, 0.10);
      border-color: rgba(190, 18, 60, 0.34);
    }
    .${GAP_CLASS} .${TEXT_CLASS} {
      color: #9f1239;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Visible text nodes under `document.body`, skipping non-content elements
 * and text already inside a highlight wrapper (both to stay idempotent and
 * to avoid re-matching a keyword's own already-wrapped text).
 */
function textNodes(): Text[] {
  if (!document.body) return [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = (node as Text).parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${WRAPPER_CLASS}`)) return NodeFilter.FILTER_REJECT;
      if (!(node as Text).textContent?.trim()) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function createHighlightElement(text: string): HTMLElement {
  const isMatch = matchByText.get(text.toLowerCase()) ?? false;
  const outer = document.createElement("span");
  outer.className = `${WRAPPER_CLASS} ${isMatch ? MATCH_CLASS : GAP_CLASS}`;
  const inner = document.createElement("span");
  inner.className = TEXT_CLASS;
  inner.textContent = text;
  outer.append(inner);
  return outer;
}

function countWrapped(): number {
  return document.querySelectorAll(`.${WRAPPER_CLASS}`).length;
}

/** Wraps every not-yet-wrapped occurrence of `activeKeywords`. Idempotent. */
function applyHighlights(): number {
  if (activeKeywords.length === 0) return 0;
  const pattern = buildPattern(activeKeywords);
  let total = countWrapped();
  if (total >= MAX_MATCHES) return total;

  outer: for (const node of textNodes()) {
    const text = node.textContent ?? "";
    pattern.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let any = false;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > lastIndex) frag.append(text.slice(lastIndex, match.index));
      frag.append(createHighlightElement(match[0]));
      lastIndex = match.index + match[0].length;
      any = true;
      total++;
      // A zero-width match would spin `pattern.lastIndex` forever.
      if (match[0].length === 0) pattern.lastIndex++;
      if (total >= MAX_MATCHES) break;
    }
    if (any) {
      if (lastIndex < text.length) frag.append(text.slice(lastIndex));
      node.replaceWith(frag);
    }
    if (total >= MAX_MATCHES) break outer;
  }
  return total;
}

function startObserver(): void {
  if (!document.body || typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(() => {
    if (reapplyTimer !== null) clearTimeout(reapplyTimer);
    reapplyTimer = setTimeout(() => {
      reapplyTimer = null;
      applyHighlights();
    }, REAPPLY_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

/**
 * Highlights every occurrence of `keywords` in the page's visible text —
 * green/teal for one `matchesProfile: true`, rose for `false` — and keeps
 * re-applying it if the host page re-renders over the highlighted text.
 * Longest keyword first so e.g. "Senior Product Manager" wins over the
 * shorter "Product Manager" also being in the list, instead of the shorter
 * one partially shadowing it. Returns how many matches were wrapped.
 */
export function highlightKeywords(keywords: JobKeyword[]): number {
  clearKeywordHighlights();
  const seen = new Set<string>();
  const cleaned: JobKeyword[] = [];
  for (const keyword of keywords) {
    const text = keyword.text.trim();
    if (text.length < 2) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ text, matchesProfile: keyword.matchesProfile });
  }
  cleaned.sort((a, b) => b.text.length - a.text.length);
  if (cleaned.length === 0) return 0;

  activeKeywords = cleaned;
  matchByText = new Map(cleaned.map((k) => [k.text.toLowerCase(), k.matchesProfile]));
  ensureStyle();
  const matched = applyHighlights();
  if (matched > 0) startObserver();
  return matched;
}

export function clearKeywordHighlights(): void {
  observer?.disconnect();
  observer = null;
  if (reapplyTimer !== null) {
    clearTimeout(reapplyTimer);
    reapplyTimer = null;
  }
  activeKeywords = [];
  matchByText = new Map();

  const wrappers = document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`);
  for (const wrapper of wrappers) {
    wrapper.replaceWith(document.createTextNode(wrapper.textContent ?? ""));
  }
  document.body?.normalize();
  document.getElementById(STYLE_ID)?.remove();
}
