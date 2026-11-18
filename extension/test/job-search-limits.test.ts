import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/storage/local", () => ({ getOpenAiApiKey: async () => "sk-test" }));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ supportModel: "" }) }));

const { streamWithWebSearch, OpenAiTimeoutError } = await import("@/features/openai/client");

/** An SSE body that sends `frames`, then hangs (or ends when `end`). */
function sse(frames: string[], end = true): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`data: ${f}\n\n`));
      if (end) controller.close();
    },
  });
}
const delta = (text: string) => JSON.stringify({ type: "response.output_text.delta", delta: text });

describe("streamWithWebSearch limits", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for low reasoning effort and streams the text", async () => {
    fetchMock.mockResolvedValue(new Response(sse([delta("a"), delta("b")]), { status: 200 }));
    const seen: string[] = [];
    expect(await streamWithWebSearch("p", (d) => seen.push(d), { reasoningEffort: "low" })).toBe("ab");
    expect(seen).toEqual(["a", "b"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.tools).toEqual([{ type: "web_search" }]);
  });

  it("retries a 429 once, then gives up with the status", async () => {
    fetchMock.mockResolvedValue(new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }));
    await expect(streamWithWebSearch("p", () => {})).rejects.toThrow(/\(429\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 401", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    await expect(streamWithWebSearch("p", () => {})).rejects.toThrow(/\(401\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a stream that goes quiet, with a clear timeout error", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = sse([delta("x")], false);
      // Like a real fetch body: aborting the request errors the stream.
      init.signal?.addEventListener("abort", () => void body.cancel().catch(() => {}));
      const reader = body.getReader();
      const wrapped = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
          ]);
          if (next.done) controller.close();
          else controller.enqueue(next.value);
        },
      });
      return new Response(wrapped, { status: 200 });
    });
    const started = Date.now();
    const err = await streamWithWebSearch("p", () => {}, { idleMs: 50, timeoutMs: 5000 }).catch((e) => e);
    expect(err).toBeInstanceOf(OpenAiTimeoutError);
    expect((err as Error).message).toMatch(/OpenAI web search \(no data\) timed out/);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
