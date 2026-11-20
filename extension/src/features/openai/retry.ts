/**
 * Retry with exponential back-off for the OpenAI calls (`client.ts`, `decisions.ts`, and the
 * agent's tool loop). The Claude fallback doesn't use it: the Anthropic SDK already retries
 * 408/409/429/5xx and connection errors with its own back-off (`maxRetries`).
 *
 * Retried: 408, 409, 429 and every 5xx (OpenAI's 503 `server_is_overloaded` among them), and a
 * request that never got an answer (network error). Never retried: other 4xx (bad key,
 * invalid request), a 429 that says the account is out of credits (`insufficient_quota` — it
 * can't pass until the user pays), and anything after the caller's signal aborted. A `Retry-After` header is
 * honoured; without one the wait doubles each attempt, with jitter so parallel calls spread out.
 */

import { isQuotaExhaustedText } from "./errors";

export interface RetryPolicy {
  /** Total attempts, the first one included. */
  maxAttempts: number;
  /** Wait before the second attempt; doubles for each one after it. */
  baseDelayMs: number;
  /** Upper bound for any single wait, `Retry-After` included. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 20_000 };

/** Swappable for tests: how the module waits and draws jitter. */
export const retryRuntime = {
  sleep: (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
  random: (): number => Math.random(),
};

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/** Seconds (`Retry-After: 2`), an HTTP date, or OpenAI's `retry-after-ms`, as milliseconds. */
export function parseRetryAfter(headers: Headers | undefined, now = Date.now()): number | null {
  if (!headers) return null;
  const ms = Number(headers.get("retry-after-ms"));
  if (headers.get("retry-after-ms") && Number.isFinite(ms) && ms >= 0) return ms;
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/**
 * The wait before attempt `attempt + 1` (`attempt` is 1 after the first failure): `Retry-After`
 * when the server sent one, else "equal jitter" — half of `base · 2^(attempt-1)` fixed, the other
 * half random — capped at `maxDelayMs`.
 */
export function backoffDelay(attempt: number, retryAfterMs: number | null, policy: RetryPolicy = DEFAULT_RETRY_POLICY, random = retryRuntime.random()): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, policy.maxDelayMs);
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(exp / 2 + (exp / 2) * random);
}

export interface RetryOptions {
  policy?: Partial<RetryPolicy>;
  signal?: AbortSignal;
  /** Called before each wait — for logs ("OpenAI 503, retrying in 2 s"). */
  onRetry?: (info: { attempt: number; delayMs: number; status?: number; error?: unknown }) => void;
}

/**
 * Runs `send` until it returns a response that isn't retryable, or attempts run out. Returns
 * the last response (possibly not ok: the caller turns it into its own error); throws the last
 * network error, or the abort reason once `signal` aborted. A retried response's body is
 * cancelled, so nothing leaks.
 */
export async function fetchWithRetry(send: () => Promise<Response>, options: RetryOptions = {}): Promise<Response> {
  const policy = { ...DEFAULT_RETRY_POLICY, ...options.policy };
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await send();
    } catch (err) {
      if (options.signal?.aborted || isAbortError(err) || attempt >= policy.maxAttempts) throw err;
      const delayMs = backoffDelay(attempt, null, policy);
      options.onRetry?.({ attempt, delayMs, error: err });
      await retryRuntime.sleep(delayMs, options.signal);
      continue;
    }
    if (res.ok || !isRetryableStatus(res.status) || attempt >= policy.maxAttempts) return res;
    if (res.status === 429 && isQuotaExhaustedText(await res.clone().text().catch(() => ""))) return res;
    const delayMs = backoffDelay(attempt, parseRetryAfter(res.headers), policy);
    options.onRetry?.({ attempt, delayMs, status: res.status });
    await res.body?.cancel().catch(() => {});
    await retryRuntime.sleep(delayMs, options.signal);
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
