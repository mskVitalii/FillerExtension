import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RETRY_POLICY, backoffDelay, fetchWithRetry, isRetryableStatus, parseRetryAfter, retryRuntime } from "@/features/openai/retry";

describe("back-off timing", () => {
  it("doubles per attempt with equal jitter: half fixed, half random", () => {
    expect(backoffDelay(1, null, DEFAULT_RETRY_POLICY, 0)).toBe(500);
    expect(backoffDelay(1, null, DEFAULT_RETRY_POLICY, 1)).toBe(1000);
    expect(backoffDelay(2, null, DEFAULT_RETRY_POLICY, 0)).toBe(1000);
    expect(backoffDelay(3, null, DEFAULT_RETRY_POLICY, 1)).toBe(4000);
  });

  it("caps the wait, Retry-After included", () => {
    expect(backoffDelay(10, null, DEFAULT_RETRY_POLICY, 1)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
    expect(backoffDelay(1, 3000, DEFAULT_RETRY_POLICY, 0.5)).toBe(3000);
    expect(backoffDelay(1, 600_000, DEFAULT_RETRY_POLICY, 0.5)).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });

  it("reads Retry-After as seconds, an HTTP date, or retry-after-ms", () => {
    expect(parseRetryAfter(new Headers({ "retry-after": "2" }))).toBe(2000);
    expect(parseRetryAfter(new Headers({ "retry-after-ms": "150", "retry-after": "9" }))).toBe(150);
    const now = Date.parse("2026-11-19T12:00:00Z");
    expect(parseRetryAfter(new Headers({ "retry-after": "Thu, 19 Nov 2026 12:00:05 GMT" }), now)).toBe(5000);
    expect(parseRetryAfter(new Headers())).toBeNull();
  });

  it("retries 408/409/429/5xx, never other 4xx", () => {
    for (const status of [408, 409, 429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(status)).toBe(true);
    for (const status of [400, 401, 403, 404, 422]) expect(isRetryableStatus(status)).toBe(false);
  });
});

describe("fetchWithRetry", () => {
  const waits: number[] = [];
  const realSleep = retryRuntime.sleep;
  beforeEach(() => {
    waits.length = 0;
    retryRuntime.sleep = async (ms) => void waits.push(ms);
  });
  afterEach(() => {
    retryRuntime.sleep = realSleep;
  });

  it("retries an overloaded 503 until it succeeds", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":{"code":"server_is_overloaded"}}', { status: 503 }))
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok"));
    const res = await fetchWithRetry(send);
    expect(await res.text()).toBe("ok");
    expect(send).toHaveBeenCalledTimes(3);
    expect(waits).toHaveLength(2);
    expect(waits[1]).toBeGreaterThanOrEqual(waits[0] / 2);
  });

  it("gives up after maxAttempts and hands back the last response", async () => {
    const send = vi.fn(async () => new Response("busy", { status: 503 }));
    const res = await fetchWithRetry(send, { policy: { maxAttempts: 3 } });
    expect(res.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("returns a 401 at once", async () => {
    const send = vi.fn(async () => new Response("bad key", { status: 401 }));
    expect((await fetchWithRetry(send)).status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("honours Retry-After", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "3" } }))
      .mockResolvedValueOnce(new Response("ok"));
    await fetchWithRetry(send);
    expect(waits).toEqual([3000]);
  });

  it("retries a network error, then throws it", async () => {
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(fetchWithRetry(send)).rejects.toThrow("Failed to fetch");
    expect(send).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.maxAttempts);
  });

  it("never retries after the caller aborted", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(fetchWithRetry(send, { signal: controller.signal })).rejects.toThrow("aborted");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
