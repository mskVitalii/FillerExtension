import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/storage/local", () => ({ getOpenAiApiKey: async () => "sk-test" }));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ supportModel: "" }) }));

const { requestStructured, streamWithWebSearch } = await import("@/features/openai/client");

const OK = { output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] };

function request() {
  return requestStructured({
    systemPrompt: "s",
    userPrompt: "u",
    schemaName: "x",
    schema: {},
    reasoningEffort: "low",
    parse: (raw) => JSON.parse(raw) as { ok: boolean },
  });
}

function bodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string) as Record<string, unknown>);
}

describe("reasoning effort", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends reasoning.effort", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(OK)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await request()).toEqual({ ok: true });
    expect(bodies(fetchMock)[0].reasoning).toEqual({ effort: "low" });
  });

  it("retries once without it when the model rejects the parameter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("Unsupported parameter: 'reasoning.effort'", { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(OK)));
    vi.stubGlobal("fetch", fetchMock);
    expect(await request()).toEqual({ ok: true });
    expect(bodies(fetchMock).map((b) => "reasoning" in b)).toEqual([true, false]);
  });

  it("doesn't retry an unrelated 400", async () => {
    const fetchMock = vi.fn(async () => new Response("Invalid schema", { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(request()).rejects.toThrow("Invalid schema");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("streamWithWebSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  function sse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body);
  }

  const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;

  it("streams output_text deltas, even when a frame is split across chunks, with the web_search tool on", async () => {
    const all = frame({ type: "response.output_text.delta", delta: "{\"a\":" }) + frame({ type: "response.output_text.delta", delta: "1}\n" }) + "data: [DONE]\n\n";
    const fetchMock = vi.fn(async () => sse([all.slice(0, 25), all.slice(25)]));
    vi.stubGlobal("fetch", fetchMock);
    const deltas: string[] = [];
    expect(await streamWithWebSearch("find jobs", (d) => deltas.push(d))).toBe('{"a":1}\n');
    expect(deltas).toEqual(['{"a":', "1}\n"]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body).toMatchObject({ stream: true, tools: [{ type: "web_search" }] });
    expect(body).not.toHaveProperty("reasoning");
  });

  it("returns an empty string when the model wrote nothing, and throws a reported failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(["data: [DONE]\n\n"])));
    expect(await streamWithWebSearch("find jobs", () => {})).toBe("");
    vi.stubGlobal("fetch", vi.fn(async () => sse([frame({ type: "response.failed", response: { error: { message: "quota" } } })])));
    await expect(streamWithWebSearch("find jobs", () => {})).rejects.toThrow("quota");
  });
});
