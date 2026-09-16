/**
 * The profile stores one salary expectation, but forms ask for it in
 * incompatible shapes: some want a bare integer that a `validateNumeric`
 * handler will accept, others a free-text box where "65-75k" is fine. The
 * user types their figure once (a single number or a range, with or without
 * currency / thousands separators / `k` suffixes); these helpers parse that
 * into a numeric range and collapse it to the single rounded value a
 * number-only field needs.
 */

export interface SalaryRange {
  low: number;
  high: number;
}

const MULTIPLIERS: Record<string, number> = {
  k: 1_000,
  к: 1_000,
  tsd: 1_000,
  тыс: 1_000,
  т: 1_000,
  m: 1_000_000,
  м: 1_000_000,
  mio: 1_000_000,
  mln: 1_000_000,
  млн: 1_000_000,
};

const TOKEN_RE = /(\d[\d.,\s]*)(k|к|tsd|тыс|т|mio|mln|млн|m|м)?/gi;

/** One number found in the input, before any cross-token suffix promotion. */
interface RawAmount {
  /** The value with its own suffix applied ("75k" → 75000, "65" → 65). */
  value: number;
  /** True when this token carried an explicit k/m-style suffix. */
  hadSuffix: boolean;
  /** The token's suffix multiplier (1 when it had none). */
  multiplier: number;
}

function readAmount(digits: string, suffix: string | undefined): RawAmount | null {
  const suf = suffix?.toLowerCase();
  const multiplier = suf ? (MULTIPLIERS[suf] ?? 1) : 1;

  let cleaned = digits.replace(/\s/g, "");
  // With a multiplier, a lone separator with 1-2 trailing digits is a
  // decimal fraction ("1.5k" -> 1500); otherwise every separator is a
  // thousands separator and gets stripped ("1.500" -> 1500).
  if (multiplier > 1 && /^\d+[.,]\d{1,2}$/.test(cleaned)) {
    cleaned = cleaned.replace(",", ".");
  } else {
    cleaned = cleaned.replace(/[.,]/g, "");
  }

  const base = Number(cleaned);
  if (!Number.isFinite(base) || base <= 0) return null;
  return { value: base * multiplier, hadSuffix: multiplier > 1, multiplier };
}

export function parseSalary(raw: string): SalaryRange | null {
  const text = raw.trim();
  if (!text) return null;

  const amounts: RawAmount[] = [];
  for (const match of text.matchAll(TOKEN_RE)) {
    const amount = readAmount(match[1], match[2]);
    if (amount) amounts.push(amount);
  }
  if (amounts.length === 0) return null;

  // "65-75k" — the "65" has no suffix of its own but clearly shares the
  // "k" of its neighbour. Promote any bare sub-1000 number when a larger
  // multiplier appears elsewhere in the input.
  const maxMultiplier = Math.max(...amounts.map((a) => a.multiplier));
  const numbers = amounts
    .map((a) => (!a.hadSuffix && maxMultiplier > 1 && a.value < 1000 ? a.value * maxMultiplier : a.value))
    // Drop stray small numbers that aren't really salaries (e.g. a "40" from
    // "40 Stunden-Woche" pasted in by accident).
    .filter((value) => value >= 1000)
    .map((value) => Math.round(value));
  if (numbers.length === 0) return null;

  return { low: Math.min(...numbers), high: Math.max(...numbers) };
}

/** Midpoint of the range, rounded to the nearest 1000 (a single figure gets rounded too). */
export function salaryMidpoint(range: SalaryRange): number {
  return Math.round((range.low + range.high) / 2 / 1000) * 1000;
}

/** Bare-integer string for a number-only field, or null if the input can't be parsed. */
export function salaryNumericValue(raw: string): string | null {
  const range = parseSalary(raw);
  return range ? String(salaryMidpoint(range)) : null;
}

/** "65000 - 75000" for a real range, a bare integer when both ends match. */
export function formatSalaryRange(range: SalaryRange): string {
  return range.low === range.high ? String(range.low) : `${range.low} - ${range.high}`;
}

/**
 * Tidies what the user typed in Settings into a canonical stored form -
 * "65000 - 75000" for a range, a bare integer otherwise - so the autofill
 * side always parses the same shape. Unparseable input is left untouched.
 */
export function formatSalaryForStorage(raw: string): string {
  const range = parseSalary(raw);
  return range ? formatSalaryRange(range) : raw.trim();
}

/**
 * A discrete-choice salary field (a `<select>` or a react-select-style
 * flyout, confirmed live on greenhouse.io — e.g. "25.000€ - 35.000€",
 * "115.000€ +") never accepts a typed number at all; it has to be answered
 * by picking whichever bracket the profile's own expectation falls into. A
 * trailing "+" (no matching upper bound for `parseSalary` to find) reads as
 * an open-ended top bracket rather than a lone point value.
 */
function parseSalaryBracket(text: string): SalaryRange | null {
  const range = parseSalary(text);
  if (!range) return null;
  return /\+\s*$/.test(text.trim()) ? { low: range.low, high: Infinity } : range;
}

/**
 * The option text from `options` whose bracket best fits the profile's
 * parsed salary — the bracket containing its midpoint, or (should no
 * bracket actually contain it, e.g. a form with gaps between brackets) the
 * numerically closest one. `null` when either side fails to parse at all
 * (the profile value, or every option).
 */
export function matchSalaryBracket(options: string[], raw: string): string | null {
  const target = parseSalary(raw);
  if (!target) return null;
  const point = salaryMidpoint(target);

  const brackets = options
    .map((text) => ({ text, range: parseSalaryBracket(text) }))
    .filter((b): b is { text: string; range: SalaryRange } => b.range !== null);
  if (brackets.length === 0) return null;

  const containing = brackets.find((b) => point >= b.range.low && point <= b.range.high);
  if (containing) return containing.text;

  let best = brackets[0];
  let bestDistance = Infinity;
  for (const bracket of brackets) {
    const mid = bracket.range.high === Infinity ? bracket.range.low : (bracket.range.low + bracket.range.high) / 2;
    const distance = Math.abs(mid - point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = bracket;
    }
  }
  return best.text;
}
