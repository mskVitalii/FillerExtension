const LOWER = "abcdefghjkmnpqrstuvwxyz"; // no i, l, o — easy to misread once retyped from memory
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789"; // no 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";

export interface PasswordOptions {
  length?: number;
  /** Some registration forms reject symbol characters outright — off by default stays safe, on gives more entropy. */
  symbols?: boolean;
}

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Rejection-free modulo bias is not worth the complexity for a password charset this small.
  return buf[0] % max;
}

/**
 * Generates a strong random password for registration forms (spec: "some
 * forms need a fresh password, not a profile value"). Guarantees at least
 * one character from each included pool, then fills and shuffles the rest —
 * so a fixed length never produces e.g. an all-lowercase result. Avoids
 * visually ambiguous characters (0/O, 1/l/I) since the user may need to read
 * this back off-screen (copied into a password manager, written down, etc).
 */
export function generatePassword(options: PasswordOptions = {}): string {
  const { length = 16, symbols = true } = options;
  const pools = [LOWER, UPPER, DIGITS, ...(symbols ? [SYMBOLS] : [])];
  const all = pools.join("");

  const chars = pools.map((pool) => pool[randomInt(pool.length)]);
  while (chars.length < length) {
    chars.push(all[randomInt(all.length)]);
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}
