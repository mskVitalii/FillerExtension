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
