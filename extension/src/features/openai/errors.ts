/**
 * Error types shared by the OpenAI client and the Claude fallback (`anthropic.ts`). They live
 * apart from `client.ts` so the fallback modules can use them without an import cycle;
 * `client.ts` re-exports them, so existing `@/features/openai/client` imports keep working.
 */
export class OpenAiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "OpenAiError";
  }
}

export class MissingApiKeyError extends OpenAiError {
  constructor() {
    super("No OpenAI API key is configured. Add your key in the extension settings.");
    this.name = "MissingApiKeyError";
  }
}

/** Thrown when a call ran past its time budget — the message says which call and how long. */
export class OpenAiTimeoutError extends OpenAiError {
  constructor(what: string, seconds: number) {
    super(`${what} timed out after ${seconds} s.`);
    this.name = "OpenAiTimeoutError";
  }
}

/** The OpenAI request never got an HTTP answer (offline, DNS, connection reset) — after its retries. */
export class OpenAiNetworkError extends OpenAiError {
  constructor(cause: unknown) {
    super(`Could not reach OpenAI: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "OpenAiNetworkError";
  }
}

/** A failure of the Claude (Anthropic) fallback. Extends `OpenAiError` so every existing `catch` shows it the same way. */
export class ClaudeError extends OpenAiError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = "ClaudeError";
  }
}

/** Where the user adds OpenAI credits — linked from the "out of credits" hint. */
export const OPENAI_BILLING_URL = "https://platform.openai.com/settings/organization/billing/overview";

/** The `code`/`type` values OpenAI sends on a 429 when the account has no credits left. */
const QUOTA_MARKERS = /\b(insufficient_quota|credit_balance_exhausted)\b/;

/**
 * Whether an OpenAI error body (or any error text that quotes one) says the account ran out of
 * credits — as opposed to a rate limit, which also answers 429 but passes after a wait.
 */
export function isQuotaExhaustedText(text: string | undefined | null): boolean {
  return !!text && QUOTA_MARKERS.test(text);
}

/**
 * The OpenAI account behind the key has no credits left (429 `insufficient_quota` /
 * `credit_balance_exhausted`). Never retried — it can't pass until the user pays. `detail` is
 * OpenAI's own message. The `insufficient_quota` marker stays in `message`, so the Side Panel
 * still recognises it after the error crossed the message channel as plain text.
 */
export class OpenAiQuotaError extends OpenAiError {
  constructor(public detail: string) {
    super(`OpenAI credits exhausted (insufficient_quota): ${detail}`, 429);
    this.name = "OpenAiQuotaError";
  }
}

/** OpenAI's own `error.message` from an error body (JSON, possibly cut off), else the text itself. */
export function openAiErrorDetail(text: string): string {
  const trimmed = text.trim();
  try {
    const message = (JSON.parse(trimmed) as { error?: { message?: unknown } }).error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    /* not JSON, or cut off — try the field itself */
  }
  const match = /"message"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(trimmed);
  if (match) {
    try {
      return JSON.parse(`"${match[1]}"`) as string;
    } catch {
      return match[1];
    }
  }
  return trimmed;
}

/**
 * The error for a non-ok OpenAI response: `OpenAiQuotaError` when the account is out of credits,
 * else an `OpenAiError` that quotes the start of the body (`what` names the call).
 */
export function openAiHttpError(what: string, status: number, body: string): OpenAiError {
  if (status === 429 && isQuotaExhaustedText(body)) return new OpenAiQuotaError(openAiErrorDetail(body));
  return new OpenAiError(`${what} failed (${status}): ${body.slice(0, 300)}`, status);
}

/** For an error that reached the UI as text: OpenAI's own words after our quota prefix, or the text as is. */
export function quotaErrorDetail(text: string): string {
  const prefix = /OpenAI credits exhausted \(insufficient_quota\):\s*/.exec(text);
  return prefix ? text.slice(prefix.index + prefix[0].length) : openAiErrorDetail(text);
}
