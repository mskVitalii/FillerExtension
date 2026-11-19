import Anthropic from "@anthropic-ai/sdk";
import { ClaudeError } from "./errors";

/**
 * Claude (Anthropic Messages API) as the fallback provider — the same three shapes the OpenAI
 * client offers: structured JSON (`claudeStructured`), a streamed plain-text answer
 * (`claudeTextStream`) and a streamed answer with web search (`claudeWebSearchStream`).
 *
 * Called straight from the extension with the user's own Anthropic key, like the OpenAI one.
 * `dangerouslyAllowBrowser` makes the SDK send `anthropic-dangerous-direct-browser-access`,
 * which is what lets api.anthropic.com answer a browser (CORS) — so no host permission is
 * needed. The SDK retries 408/409/429/5xx and network errors itself (`maxRetries`).
 */

/** Strongest — the default for text that goes straight into the application (cover letters, outreach). */
export const CLAUDE_MODEL_MAIN = "claude-opus-5-5";
/** Fast and cheap — the default for support tasks, like `gpt-6-luna` on the OpenAI side. */
export const CLAUDE_MODEL_SUPPORT = "claude-haiku-5-5";
/** Offered in the Settings selectors. */
export const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"] as const;

const MAX_RETRIES = 2;
const STRUCTURED_MAX_TOKENS = 16_000;
const STREAM_MAX_TOKENS = 32_000;

/** Models that take the server-side refusal fallback (`fallbacks: "default"`); Haiku has none. */
const SERVER_FALLBACK_MODEL = /^claude-(opus|sonnet|fable)-/;
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type ClaudeEffort = "low" | "medium" | "high";

/** OpenAI's `reasoning.effort` → Claude's `output_config.effort` (Claude has no "minimal"). */
export function claudeEffort(effort: "minimal" | "low" | "medium" | "high" | undefined): ClaudeEffort | undefined {
  if (!effort) return undefined;
  return effort === "minimal" ? "low" : effort;
}

export function isClaudeModel(id: string): boolean {
  return /^claude-[a-z]+-\d/.test(id);
}

/** The SDK client every Claude call uses — also the agent's tool loop (FillerAgent `openai/responses.ts`). */
export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    maxRetries: MAX_RETRIES,
    // Late-bound, so a fetch wrapper installed after import (the agent's usage tracking, tests) is used.
    fetch: (input, init) => globalThis.fetch(input, init),
  });
}

/** Keeps a Claude failure readable and shaped like the OpenAI ones (status + short body). */
export function toClaudeError(err: unknown): unknown {
  if (err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIError) {
    return new ClaudeError(`Claude request failed${err.status ? ` (${err.status})` : ""}: ${err.message.slice(0, 300)}`, err.status ?? undefined);
  }
  return err;
}

/**
 * OpenAI strict schemas → what Claude's structured outputs accept: `type: ["string", "null"]`
 * becomes `anyOf`, and numeric/length/array-size constraints (unsupported there) are dropped —
 * the caller's `parse` still validates the result.
 */
export function toClaudeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toClaudeSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (UNSUPPORTED_KEYWORDS.has(key)) continue;
    if (key === "properties" || key === "$defs" || key === "definitions") {
      out[key] = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([name, sub]) => [name, toClaudeSchema(sub)]));
    } else out[key] = toClaudeSchema(value);
  }
  if (Array.isArray(out.type)) {
    const types = out.type as string[];
    delete out.type;
    // An `enum` already pins the allowed values (null included), so the type list is redundant.
    if (!("enum" in out)) {
      return { anyOf: types.map((type) => ({ ...(type === "null" ? {} : out), type })) };
    }
  }
  return out;
}

const UNSUPPORTED_KEYWORDS = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems"]);

interface CommonParams {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  effort?: ClaudeEffort;
  signal?: AbortSignal;
}

/** The request fields every call shares; the refusal fallback only where the model has one. */
function baseParams(params: CommonParams, maxTokens: number) {
  const serverFallback = SERVER_FALLBACK_MODEL.test(params.model);
  return {
    model: params.model,
    max_tokens: maxTokens,
    system: params.system || undefined,
    messages: [{ role: "user" as const, content: params.user }],
    ...(serverFallback ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

function textOf(content: { type: string; text?: string }[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function assertNotRefused(message: { stop_reason: string | null; stop_details?: { category?: string | null } | null }): void {
  if (message.stop_reason === "refusal") {
    throw new ClaudeError(`Claude declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.`);
  }
}

/** One JSON answer that follows `schema` (`output_config.format`), parsed by the caller. */
export async function claudeStructured<T>(params: CommonParams & { schema: Record<string, unknown>; parse: (raw: string) => T }): Promise<T> {
  try {
    const message = await createClaudeClient(params.apiKey).beta.messages.create(
      {
        ...baseParams(params, STRUCTURED_MAX_TOKENS),
        output_config: {
          format: { type: "json_schema", schema: toClaudeSchema(params.schema) as Record<string, unknown> },
          ...(params.effort ? { effort: params.effort } : {}),
        },
      },
      { signal: params.signal },
    );
    assertNotRefused(message);
    if (message.stop_reason === "max_tokens") throw new ClaudeError("Claude's answer was cut off (max_tokens).");
    const raw = textOf(message.content);
    if (!raw) throw new ClaudeError("Claude response had no content.");
    return params.parse(raw);
  } catch (err) {
    throw toClaudeError(err);
  }
}

/** Streams the answer's text through `onDelta`; resolves with all of it. */
export async function claudeTextStream(params: CommonParams & { onDelta: (delta: string) => void; onChunk?: () => void }): Promise<string> {
  return streamText(params, undefined);
}

/**
 * Like `claudeTextStream`, with Anthropic's server-side web search tool. A long search can end
 * a turn with `pause_turn`; the turn is then continued (a few times at most) and its text keeps
 * streaming into the same answer.
 */
export async function claudeWebSearchStream(params: CommonParams & { onDelta: (delta: string) => void; onChunk?: () => void }): Promise<string> {
  return streamText(params, [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }]);
}

const MAX_CONTINUATIONS = 3;

async function streamText(
  params: CommonParams & { onDelta: (delta: string) => void; onChunk?: () => void },
  tools: Anthropic.Beta.BetaToolUnion[] | undefined,
): Promise<string> {
  const api = createClaudeClient(params.apiKey);
  const base = baseParams(params, STREAM_MAX_TOKENS);
  const messages: Anthropic.Beta.BetaMessageParam[] = [...base.messages];
  let full = "";
  try {
    for (let turn = 0; ; turn++) {
      const stream = api.beta.messages.stream(
        {
          ...base,
          messages,
          ...(tools ? { tools } : {}),
          ...(params.effort ? { output_config: { effort: params.effort } } : {}),
        },
        { signal: params.signal },
      );
      stream.on("streamEvent", () => params.onChunk?.());
      stream.on("text", (delta) => {
        full += delta;
        params.onDelta(delta);
      });
      const message = await stream.finalMessage();
      assertNotRefused(message);
      if (message.stop_reason !== "pause_turn" || turn >= MAX_CONTINUATIONS) break;
      messages.push({ role: "assistant", content: message.content as Anthropic.Beta.BetaContentBlockParam[] });
    }
  } catch (err) {
    throw toClaudeError(err);
  }
  return full;
}
