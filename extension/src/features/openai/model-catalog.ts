import { getLocal, setLocal } from "@/features/storage/local";

/**
 * The models Filler can call, with their list prices and what each one accepts — read from
 * OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`: no key, CORS-open,
 * prices per token, `reasoning.supported_efforts`, `supported_parameters`, context and output
 * limits). OpenAI's and Anthropic's own `/v1/models` list models but no prices.
 *
 * Only what Filler uses is kept: OpenAI GPT-6+ text models and current Claude models (5+), under
 * their native API ids. The list is cached (`modelCatalogCache` in chrome.storage.local — the
 * agent keeps its own copy on disk) and refreshed at most daily; offline, the last cached list
 * or the bundled one below answers. Prices are the base tier (OpenRouter also lists long-context
 * surcharges past ~272K tokens, which Filler's prompts never reach).
 */

export type ModelProvider = "openai" | "anthropic";

/** OpenAI's `reasoning.effort` / Claude's `output_config.effort` values, weakest first. */
export const EFFORT_SCALE = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORT_SCALE)[number];

export interface ModelInfo {
  /** The id the provider's own API takes (`gpt-6.1-sol`, `claude-opus-5-5`). */
  id: string;
  provider: ModelProvider;
  name: string;
  /** USD per 1M tokens; `cachedInput` is a cache read. */
  price: { input: number; cachedInput: number; output: number };
  contextLength: number;
  maxOutput: number;
  /** Efforts the model accepts — empty when it takes no effort parameter at all. */
  efforts: Effort[];
  /** Reasoning can't be turned off (no "none"). */
  reasoningMandatory: boolean;
  /** Takes a JSON schema for its output (OpenAI `text.format`, Claude `output_config.format`). */
  structuredOutputs: boolean;
  tools: boolean;
}

export interface ModelCatalog {
  /** ISO time of the fetch; "" for the bundled list. */
  fetchedAt: string;
  source: "openrouter" | "bundled";
  models: ModelInfo[];
}

export const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
/** How old a cached list may get before the next refresh fetches a new one. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const NON_TEXT_MODEL = /realtime|audio|tts|transcribe|whisper|image|live|cyber|search|embedding|codex/;

/**
 * A GPT-6+ general text model (`gpt-6-luna`, `gpt-6.1-sol`): no dated snapshots, no specialized
 * variants (realtime, audio, image, cyber…), no `-pro` ones (Responses-only background models,
 * minutes per answer). Older GPT generations don't count — Filler only targets 6+.
 */
export function isOpenAiTextModel(id: string): boolean {
  const match = /^gpt-(\d+)(?:\.\d+)?-[a-z]+$/.exec(id);
  return !!match && Number(match[1]) >= 6 && !NON_TEXT_MODEL.test(id);
}

/** A current Claude model (`claude-opus-5-5`): generation 5+, not the verified-orgs-only Mythos. */
export function isCurrentClaudeModel(id: string): boolean {
  const match = /^claude-([a-z]+)-(\d+)(?:-\d+)?$/.exec(id);
  return !!match && Number(match[2]) >= 5 && match[1] !== "mythos";
}

const model = (id: string, name: string, input: number, cachedInput: number, output: number, efforts: Effort[]): ModelInfo => ({
  id,
  provider: id.startsWith("claude-") ? "anthropic" : "openai",
  name,
  price: { input, cachedInput, output },
  contextLength: id.startsWith("claude-") ? 1_000_000 : 1_050_000,
  maxOutput: 128_000,
  efforts,
  reasoningMandatory: !efforts.includes("none"),
  structuredOutputs: true,
  tools: true,
});

const ALL: Effort[] = ["none", "low", "medium", "high", "xhigh", "max"];
const MANDATORY: Effort[] = ["low", "medium", "high", "xhigh", "max"];

/** OpenRouter's list as of 2026-11-19 — what answers before the first fetch, and offline. */
export const BUNDLED_CATALOG: ModelCatalog = {
  fetchedAt: "",
  source: "bundled",
  models: [
    model("gpt-6.2-sol", "GPT-6.2 Sol", 2, 0.1, 10, MANDATORY),
    model("gpt-6.2-astra", "GPT-6.2 Astra", 8, 0.4, 40, MANDATORY),
    model("gpt-6.1-sol", "GPT-6.1 Sol", 2, 0.1, 10, MANDATORY),
    model("gpt-6.1-terra", "GPT-6.1 Terra", 1, 0.05, 5, ALL),
    model("gpt-6-sol", "GPT-6 Sol", 2, 0.2, 10, ALL),
    model("gpt-6-luna", "GPT-6 Luna", 0.1, 0.01, 0.5, ALL),
    model("gpt-6-astra", "GPT-6 Astra", 10, 1, 50, MANDATORY),
    model("claude-opus-5-5", "Claude Opus 5.5", 4, 0.2, 20, MANDATORY),
    model("claude-sonnet-5-5", "Claude Sonnet 5.5", 2, 0.1, 10, MANDATORY),
    model("claude-haiku-5-5", "Claude Haiku 5.5", 0.1, 0.01, 0.5, ALL),
    model("claude-fable-5-2", "Claude Fable 5.2", 8, 0.2, 40, MANDATORY),
  ],
};

interface OpenRouterModel {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: Record<string, unknown>;
  top_provider?: { max_completion_tokens?: number | null; context_length?: number | null };
  supported_parameters?: string[];
  reasoning?: { mandatory?: boolean; supported_efforts?: string[] } | null;
}

/** `$ per token` string → `$ per 1M tokens`, rounded off float noise. */
const perMillion = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : 0;
};

/** OpenRouter's id → the provider's own: `openai/gpt-6.1-sol` → `gpt-6.1-sol`, `anthropic/claude-opus-5.5` → `claude-opus-5-5`. */
export function nativeModelId(openRouterId: string): { provider: ModelProvider; id: string } | null {
  const [vendor, rest] = openRouterId.split("/", 2);
  if (!rest || rest.includes(":")) return null; // ":batch", ":free"… variants
  if (vendor === "openai") return isOpenAiTextModel(rest) ? { provider: "openai", id: rest } : null;
  if (vendor === "anthropic") {
    const id = rest.replace(/\./g, "-");
    return isCurrentClaudeModel(id) ? { provider: "anthropic", id } : null;
  }
  return null;
}

/** OpenRouter's `GET /api/v1/models` body → Filler's catalog (OpenAI GPT-6+ and Claude 5+ only). */
export function parseOpenRouterModels(body: unknown, fetchedAt = new Date().toISOString()): ModelCatalog {
  const data = (body as { data?: OpenRouterModel[] } | null)?.data;
  if (!Array.isArray(data)) throw new Error("OpenRouter model list: unexpected response.");
  const models: ModelInfo[] = [];
  for (const entry of data) {
    const native = entry.id ? nativeModelId(entry.id) : null;
    if (!native || !entry.pricing || models.some((m) => m.id === native.id)) continue;
    const params = entry.supported_parameters ?? [];
    const efforts = (entry.reasoning?.supported_efforts ?? []).filter((e): e is Effort => (EFFORT_SCALE as readonly string[]).includes(e));
    const takesEffort = params.includes("reasoning") || params.includes("reasoning_effort");
    models.push({
      id: native.id,
      provider: native.provider,
      name: (entry.name ?? native.id).replace(/^[^:]+:\s*/, ""),
      price: { input: perMillion(entry.pricing.prompt), cachedInput: perMillion(entry.pricing.input_cache_read ?? entry.pricing.prompt), output: perMillion(entry.pricing.completion) },
      contextLength: entry.top_provider?.context_length ?? entry.context_length ?? 0,
      maxOutput: entry.top_provider?.max_completion_tokens ?? 0,
      efforts: takesEffort ? EFFORT_SCALE.filter((e) => efforts.includes(e)) : [],
      reasoningMandatory: Boolean(entry.reasoning?.mandatory),
      structuredOutputs: params.includes("structured_outputs"),
      tools: params.includes("tools"),
    });
  }
  if (models.length === 0) throw new Error("OpenRouter model list had none of the OpenAI/Claude models Filler uses.");
  // Newest generation first within each provider, OpenAI before Claude.
  models.sort((a, b) => a.provider.localeCompare(b.provider) * -1 || b.id.localeCompare(a.id, undefined, { numeric: true }));
  return { fetchedAt, source: "openrouter", models };
}

/** Fetches and parses the list; throws on any failure (the caller keeps what it had). */
export async function fetchModelCatalog(signal?: AbortSignal): Promise<ModelCatalog> {
  const res = await fetch(OPENROUTER_MODELS_URL, { signal: signal ?? AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`OpenRouter model list failed (${res.status}).`);
  return parseOpenRouterModels(await res.json());
}

export function isCatalogStale(catalog: ModelCatalog, now = Date.now()): boolean {
  return catalog.source === "bundled" || !catalog.fetchedAt || now - Date.parse(catalog.fetchedAt) > CATALOG_MAX_AGE_MS;
}

/** The cached list, or the bundled one. Never throws, never fetches. */
export async function getModelCatalog(): Promise<ModelCatalog> {
  try {
    const cached = await getLocal("modelCatalogCache");
    if (cached && Array.isArray(cached.models) && cached.models.length > 0) return cached;
  } catch {
    /* no storage (tests) */
  }
  return BUNDLED_CATALOG;
}

/** Fetches a new list when the cached one is a day old (or `force`); on failure keeps the cached one. */
export async function refreshModelCatalog(options: { force?: boolean } = {}): Promise<ModelCatalog> {
  const current = await getModelCatalog();
  if (!options.force && !isCatalogStale(current)) return current;
  try {
    const next = await fetchModelCatalog();
    await setLocal("modelCatalogCache", next);
    return next;
  } catch {
    return current;
  }
}

/** Defaults for a model the catalog doesn't list (a newer one picked by hand): assume the current generation's shape. */
export function defaultModelInfo(id: string): ModelInfo {
  const known = BUNDLED_CATALOG.models.find((m) => m.id === id);
  if (known) return known;
  return { ...model(id, id, 0, 0, 0, MANDATORY), efforts: id.startsWith("claude-") || isOpenAiTextModel(id) ? MANDATORY : [] };
}

/** What `id` accepts, from the cached catalog — or `defaultModelInfo`. */
export async function getModelInfo(id: string): Promise<ModelInfo> {
  const catalog = await getModelCatalog();
  return catalog.models.find((m) => m.id === id) ?? defaultModelInfo(id);
}

/**
 * The effort to send for `requested` on this model: the requested one when it takes it, else the
 * nearest stronger one it takes (`minimal` → `low` on GPT-6, `none` → `low` where reasoning is
 * mandatory), else the nearest weaker. `undefined` when the model takes no effort parameter.
 */
export function effortFor(info: ModelInfo, requested: Effort | undefined): Effort | undefined {
  if (!requested || info.efforts.length === 0) return undefined;
  if (info.efforts.includes(requested)) return requested;
  const at = EFFORT_SCALE.indexOf(requested);
  const stronger = EFFORT_SCALE.slice(at + 1).find((e) => info.efforts.includes(e));
  return stronger ?? [...EFFORT_SCALE.slice(0, at)].reverse().find((e) => info.efforts.includes(e));
}
