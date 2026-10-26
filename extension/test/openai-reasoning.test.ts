import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/features/storage/local", () => ({ getOpenAiApiKey: async () => "sk-test" }));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ supportModel: "" }) }));

const { requestStructured } = await import("@/features/openai/client");

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
