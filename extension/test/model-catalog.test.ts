import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelCatalog } from "@/features/openai/model-catalog";

const store: { modelCatalogCache?: ModelCatalog } = {};
vi.mock("@/features/storage/local", () => ({
  getOpenAiApiKey: async () => "sk-test",
  getAnthropicApiKey: async () => "sk-ant-test",
  getLocal: async (key: "modelCatalogCache") => store[key],
  setLocal: async (key: "modelCatalogCache", value: ModelCatalog) => void (store[key] = value),
}));
const prefs = { supportModel: "", aiFallbackPolicy: "always", claudeMainModel: "", claudeSupportModel: "" };
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ ...prefs }) }));

const catalog = await import("@/features/openai/model-catalog");
const { BUNDLED_CATALOG, effortFor, isCatalogStale, nativeModelId, parseOpenRouterModels, refreshModelCatalog, defaultModelInfo } = catalog;

/** Trimmed entries in the shape OpenRouter's `GET /api/v1/models` returns. */
const OPENROUTER = {
  data: [
    {
      id: "openai/gpt-6-luna",
      name: "OpenAI: GPT-6 Luna",
      context_length: 1050000,
      pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.00000001" },
      top_provider: { context_length: 1050000, max_completion_tokens: 128000 },
      supported_parameters: ["reasoning", "reasoning_effort", "structured_outputs", "tools"],
      reasoning: { mandatory: false, supported_efforts: ["max", "xhigh", "high", "medium", "low", "none"] },
    },
    { id: "openai/gpt-6-luna:batch", name: "batch", pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-6-sol-pro", name: "OpenAI: GPT-6 Sol Pro", pricing: { prompt: "0.000002", completion: "0.00001" } },
    { id: "openai/gpt-5.5", name: "OpenAI: GPT-5.5", pricing: { prompt: "0.000001", completion: "0.000008" } },
    {
      id: "anthropic/claude-opus-5.5",
      name: "Anthropic: Claude Opus 5.5",
      context_length: 1000000,
      pricing: { prompt: "0.000004", completion: "0.00002", input_cache_read: "0.0000002" },
      top_provider: { context_length: 1000000, max_completion_tokens: 128000 },
      supported_parameters: ["reasoning", "structured_outputs", "tools"],
      reasoning: { mandatory: true, supported_efforts: ["max", "xhigh", "high", "medium", "low"] },
    },
    { id: "anthropic/claude-opus-4.8", name: "Anthropic: Claude Opus 4.8", pricing: { prompt: "0.000005", completion: "0.000025" } },
    { id: "google/gemini-3-pro", name: "Gemini", pricing: { prompt: "0.000001", completion: "0.000001" } },
  ],
};

describe("parsing OpenRouter's model list", () => {
  it("keeps GPT-6+ and Claude 5+ under their native ids, with prices per 1M and capabilities", () => {
    const parsed = parseOpenRouterModels(OPENROUTER, "2026-11-19T00:00:00.000Z");
    expect(parsed.source).toBe("openrouter");
    expect(parsed.models.map((m) => m.id)).toEqual(["gpt-6-luna", "claude-opus-5-5"]);
    expect(parsed.models[0]).toEqual({
      id: "gpt-6-luna",
      provider: "openai",
      name: "GPT-6 Luna",
      price: { input: 0.1, cachedInput: 0.01, output: 0.5 },
      contextLength: 1050000,
      maxOutput: 128000,
      efforts: ["none", "low", "medium", "high", "xhigh", "max"],
      reasoningMandatory: false,
      structuredOutputs: true,
      tools: true,
    });
    expect(parsed.models[1]).toMatchObject({ provider: "anthropic", price: { input: 4, cachedInput: 0.2, output: 20 }, reasoningMandatory: true });
  });

  it("maps ids and skips variants, older generations and other vendors", () => {
    expect(nativeModelId("openai/gpt-6.1-sol")).toEqual({ provider: "openai", id: "gpt-6.1-sol" });
    expect(nativeModelId("anthropic/claude-haiku-5.5")).toEqual({ provider: "anthropic", id: "claude-haiku-5-5" });
    for (const id of ["openai/gpt-6-luna:batch", "openai/gpt-6-sol-pro", "openai/gpt-5.5", "anthropic/claude-opus-4.8", "anthropic/claude-mythos-5.2", "meta/llama-5"]) {
      expect(nativeModelId(id)).toBeNull();
    }
  });

  it("rejects a response without the models Filler uses", () => {
    expect(() => parseOpenRouterModels({ data: [] })).toThrow();
    expect(() => parseOpenRouterModels({ error: "x" })).toThrow();
  });
});

describe("effort per model", () => {
  const luna = BUNDLED_CATALOG.models.find((m) => m.id === "gpt-6-luna")!;
  const sol = BUNDLED_CATALOG.models.find((m) => m.id === "gpt-6.1-sol")!;
  it("sends what the model takes, else the nearest stronger effort", () => {
    expect(effortFor(luna, "low")).toBe("low");
    expect(effortFor(luna, "minimal")).toBe("low");
    expect(effortFor(luna, "none")).toBe("none");
    expect(effortFor(sol, "none")).toBe("low");
    expect(effortFor({ ...sol, efforts: ["low", "medium"] }, "max")).toBe("medium");
    expect(effortFor({ ...sol, efforts: [] }, "low")).toBeUndefined();
    expect(effortFor(sol, undefined)).toBeUndefined();
  });

  it("assumes the current generation's shape for an unlisted model", () => {
    expect(defaultModelInfo("gpt-6.9-nova").efforts).toContain("low");
    expect(defaultModelInfo("gpt-6.9-nova").structuredOutputs).toBe(true);
  });
});

describe("cache and refresh", () => {
  beforeEach(() => {
    delete store.modelCatalogCache;
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fetches when only the bundled list is there, then serves the cache for a day", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(OPENROUTER)));
    vi.stubGlobal("fetch", fetchMock);
    const first = await refreshModelCatalog();
    expect(first.source).toBe("openrouter");
    expect(store.modelCatalogCache?.models).toHaveLength(2);
    await refreshModelCatalog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isCatalogStale({ ...first, fetchedAt: new Date(Date.now() - 25 * 3600_000).toISOString() })).toBe(true);
  });

  it("keeps what it had when OpenRouter can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await refreshModelCatalog({ force: true })).toBe(BUNDLED_CATALOG);
    expect(store.modelCatalogCache).toBeUndefined();
  });
});

describe("request shape from the catalog", () => {
  const bodies: { url: string; body: Record<string, unknown> }[] = [];
  beforeEach(() => {
    bodies.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        bodies.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
        const claude = { id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
        const openai = { output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":true}' }] }] };
        return new Response(JSON.stringify(url.includes("anthropic") ? claude : openai), { headers: { "content-type": "application/json" } });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete store.modelCatalogCache;
    prefs.aiFallbackPolicy = "always";
  });

  it("OpenAI: 'minimal' goes out as 'low' on GPT-6, and a model without structured outputs gets JSON mode", async () => {
    prefs.aiFallbackPolicy = "off";
    await request("gpt-6-luna", "minimal");
    expect(bodies[0].body.reasoning).toEqual({ effort: "low" });
    expect(bodies[0].body.text).toMatchObject({ format: { type: "json_schema", strict: true } });

    store.modelCatalogCache = {
      fetchedAt: new Date().toISOString(),
      source: "openrouter",
      models: [{ ...BUNDLED_CATALOG.models.find((m) => m.id === "gpt-6-luna")!, id: "gpt-6.3-luna", structuredOutputs: false, efforts: [] }],
    };
    await request("gpt-6.3-luna", "low");
    const body = bodies[1].body as { reasoning?: unknown; text: unknown; input: { content: string }[] };
    expect(body.reasoning).toBeUndefined();
    expect(body.text).toEqual({ format: { type: "json_object" } });
    expect(body.input[0].content).toContain("JSON schema");
  });

  const request = (model: string, reasoningEffort?: "minimal" | "low") =>
    import("@/features/openai/client").then(({ requestStructured }) =>
      requestStructured({ systemPrompt: "s", userPrompt: "u", schemaName: "x", schema: { type: "object" }, model, reasoningEffort, parse: (raw) => JSON.parse(raw) as unknown }),
    );

  it("Claude (policy 'always'): effort and output cap follow the model, and 'minimal' becomes 'low'", async () => {
    store.modelCatalogCache = {
      fetchedAt: new Date().toISOString(),
      source: "openrouter",
      models: [{ ...BUNDLED_CATALOG.models.find((m) => m.id === "claude-haiku-5-5")!, maxOutput: 8000 }],
    };
    await request("gpt-6-luna", "minimal");
    const body = bodies[0].body as { max_tokens: number; output_config: { effort: string; format: unknown } };
    expect(body.max_tokens).toBe(8000);
    expect(body.output_config.effort).toBe("low");
    expect(body.output_config.format).toBeTruthy();
  });

  it("Claude without structured outputs gets the schema in the prompt instead", async () => {
    store.modelCatalogCache = {
      fetchedAt: new Date().toISOString(),
      source: "openrouter",
      models: [{ ...BUNDLED_CATALOG.models.find((m) => m.id === "claude-haiku-5-5")!, structuredOutputs: false, efforts: [] }],
    };
    await request("gpt-6-luna", "low");
    const body = bodies[0].body as { system: string; output_config?: unknown };
    expect(body.output_config).toBeUndefined();
    expect(body.system).toContain("JSON schema");
  });
});
