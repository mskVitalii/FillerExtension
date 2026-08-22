/**
 * Rule-based AI-slop detector, ported from the `no-ai-slop` skill's pattern
 * catalogue. Generated cover letters are exactly the kind of text that
 * drifts into generic AI-sounding prose (hedging, empty importance-puffery,
 * "not X, it's Y" contrasts, throat-clearing openers, summary-recap
 * endings), which undermines the "tailored, grounded, specific" letter the
 * spec calls for (sections 15-16). This only covers the mechanically
 * detectable subset of the skill's rules — nuanced judgment calls (colon
 * reveals, robotic rhythm, fake-profound kickers) are left to the editor
 * pass in `polish.ts`, which reuses the skill's own instructions.
 */
export interface SlopFinding {
  pattern: string;
  match: string;
}

const BANNED_WORDS = [
  "delve",
  "foster",
  "leverage",
  "utilize",
  "facilitate",
  "empower",
  "streamline",
  "robust",
  "cutting-edge",
  "paradigm shift",
  "game changer",
  "this is huge",
  "this changes everything",
  "tapestry",
  "realm",
  "beacon",
  "multifaceted",
  "meticulous",
  "intricate",
  "paramount",
  "transformative",
  "elevate",
  "embark",
  "supercharge",
  "harness",
  "ever-evolving",
];

const EMPTY_PHRASES = [
  "it's worth noting",
  "it is worth noting",
  "it's important to note",
  "it is important to note",
  "at the end of the day",
  "when it comes to",
  "at its core",
  "in today's world",
  "in the age of",
  "in the world of",
  "the reality is",
  "the truth is",
  "in terms of",
  "with regard to",
  "in order to",
  "going forward",
];

const THROAT_CLEARING_OPENERS = [
  "here's the thing",
  "here's what i mean",
  "let me be clear",
  "i'll be honest",
  "the uncomfortable truth is",
];

const FAUX_INSIGHT_SETUPS = [
  "this is the part most people skip",
  "what most people get wrong",
  "here's what nobody tells you",
  "the part everyone misses",
];

const IMPORTANCE_PUFFERY = [
  "stands as a testament",
  "marks a pivotal moment",
  "plays a vital role",
  "solidifies its position",
  "underscores its significance",
];

const WEASEL_ATTRIBUTION = [
  "experts agree",
  "industry reports suggest",
  "many argue",
  "widely regarded as",
  "studies show",
];

const SUMMARY_RECAP_STARTS = [/^in conclusion\b/i, /^ultimately\b/i, /^overall\b/i];

function wordBoundaryPattern(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped.replace(/ /g, "\\s+")}\\b`, "i");
}

function findPhraseMatches(text: string, phrases: string[], patternLabel: string): SlopFinding[] {
  const findings: SlopFinding[] = [];
  for (const phrase of phrases) {
    const match = wordBoundaryPattern(phrase).exec(text);
    if (match) findings.push({ pattern: patternLabel, match: match[0] });
  }
  return findings;
}

/** "This is not X. It's Y." / "The question isn't X, it's Y." / "not just X but/it's Y." */
function findBinaryContrast(text: string): SlopFinding[] {
  const pattern = /\b(?:isn'?t|is not)\b[^.!?]{3,60}[,.]?\s*(?:it'?s|it is)\b[^.!?]{3,80}[.!?]/i;
  const notJustPattern =
    /\bnot just\b[^.!?]{3,60}(?:\bbut\b|[,.]?\s*(?:it'?s|it is)\b)[^.!?]{0,80}[.!?]/i;
  const findings: SlopFinding[] = [];
  const match = pattern.exec(text);
  if (match) findings.push({ pattern: "binary-contrast", match: match[0].trim() });
  const notJustMatch = notJustPattern.exec(text);
  if (notJustMatch) findings.push({ pattern: "binary-contrast", match: notJustMatch[0].trim() });
  return findings;
}

function findSummaryRecapEnding(text: string): SlopFinding[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lastParagraph = paragraphs[paragraphs.length - 1];
  if (!lastParagraph) return [];
  for (const pattern of SUMMARY_RECAP_STARTS) {
    if (pattern.test(lastParagraph)) {
      return [{ pattern: "summary-recap-ending", match: lastParagraph.slice(0, 60) }];
    }
  }
  return [];
}

function findEmDashOveruse(text: string): SlopFinding[] {
  const count = (text.match(/—/g) ?? []).length;
  if (count > 2) {
    return [{ pattern: "em-dash-overuse", match: `${count} em dashes` }];
  }
  return [];
}

/** Runs the full rule set against a generated cover letter. */
export function detectSlop(text: string): SlopFinding[] {
  return [
    ...findPhraseMatches(text, BANNED_WORDS, "banned-word"),
    ...findPhraseMatches(text, EMPTY_PHRASES, "empty-phrase"),
    ...findPhraseMatches(text, THROAT_CLEARING_OPENERS, "throat-clearing-opener"),
    ...findPhraseMatches(text, FAUX_INSIGHT_SETUPS, "faux-insight-setup"),
    ...findPhraseMatches(text, IMPORTANCE_PUFFERY, "importance-puffery"),
    ...findPhraseMatches(text, WEASEL_ATTRIBUTION, "weasel-attribution"),
    ...findBinaryContrast(text),
    ...findSummaryRecapEnding(text),
    ...findEmDashOveruse(text),
  ];
}
