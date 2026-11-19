import { getOpenAiApiKey } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { claudeEffort, claudeStructured, claudeTextStream, claudeWebSearchStream } from "./anthropic";
import { MissingApiKeyError, OpenAiError, OpenAiNetworkError, OpenAiTimeoutError } from "./errors";
import { withClaudeFallback, type AiTier } from "./fallback";
import { fetchWithRetry, isAbortError } from "./retry";

export { ClaudeError, MissingApiKeyError, OpenAiError, OpenAiNetworkError, OpenAiTimeoutError } from "./errors";

const RESPONSES_URL = "https://api.openai.com/v1/responses";
const MODELS_URL = "https://api.openai.com/v1/models";

// OpenAI's current text models (developers.openai.com/api/docs/models, Oct 2026). All three
// support the Responses API with `text.format: json_schema`.

/** High-quality model — used for text that goes straight into the application (spec_2 item 4): near-Astra quality at a fifth of its price. */
export const MODEL_TERRA = "gpt-6.1-sol";
/** Smaller/faster model — used for support tasks (analysis, translation) where latency matters more than nuance. */
export const MODEL_LUNA = "gpt-6-luna";
/** Flagship — strongest and most expensive; offered in Settings, never a default. */
export const MODEL_ASTRA = "gpt-6-astra";

/** Curated list for the Settings selectors, and the fallback when `GET /v1/models` can't be reached. */
export const AVAILABLE_MODELS = [MODEL_TERRA, MODEL_LUNA, MODEL_ASTRA] as const;

const NON_TEXT_MODEL = /realtime|audio|tts|transcribe|whisper|image|live|cyber|search|embedding|codex/;

/**
 * Whether `id` is a model this extension can call: a curated one, or a newer GPT-6+ general text
 * model (`gpt-6.2-luna`, …) that `/v1/models` lists. Dated snapshots and specialized variants
 * (realtime, audio, image, transcription, cyber) don't count. Neither does an id saved by an
 * older version of the extension (the retired `gpt-5.6-*` ones), so such a stale preference falls
 * back to the tier default instead of failing every request.
 */
export function isSupportedModel(id: string): boolean {
  if ((AVAILABLE_MODELS as readonly string[]).includes(id)) return true;
  const match = /^gpt-(\d+)(?:\.\d+)?-[a-z]+$/.exec(id);
  return !!match && Number(match[1]) >= 6 && !NON_TEXT_MODEL.test(id);
}

/** The user's choice for a tier when it's still a supported model, otherwise the tier default. */
export function resolveModel(chosen: string, fallback: string): string {
  return chosen && isSupportedModel(chosen) ? chosen : fallback;
}

/**
 * Models for the Settings selectors: `GET /v1/models` with the user's key, narrowed by
 * `isSupportedModel`, so the list follows what that key can actually use (curated models first).
 * Falls back to `AVAILABLE_MODELS` without a key or when the call fails.
 */
export async function listAvailableModels(): Promise<string[]> {
  const fallback: string[] = [...AVAILABLE_MODELS];
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) return fallback;
  try {
    const res = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return fallback;
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((model) => model.id).filter(isSupportedModel);
    if (ids.length === 0) return fallback;
    const curated = fallback.filter((id) => ids.includes(id));
    const newer = ids.filter((id) => !curated.includes(id)).sort();
    return [...curated, ...newer];
  } catch {
    return fallback;
  }
}

/**
 * Resolves which model each tier actually calls, honoring the user's choice
 * from Settings (`Preferences.coverLetterModel`/`extractionModel`/
 * `jobAnalysisModel`/`supportModel`, an empty string meaning "not chosen
 * yet") and otherwise falling back to the tier's built-in default.
 */
export async function getCoverLetterModel(): Promise<string> {
  const prefs = await getPreferences();
  return resolveModel(prefs.coverLetterModel, MODEL_TERRA);
}

/** Job-posting extraction from raw page/pasted text (`features/job-extraction/ai-fallback.ts`). */
export async function getExtractionModel(): Promise<string> {
  const prefs = await getPreferences();
  return resolveModel(prefs.extractionModel, MODEL_LUNA);
}

/** Analysis of an already-extracted job posting (`job-analysis.ts`, `analyze-job-brief.ts`). */
export async function getJobAnalysisModel(): Promise<string> {
  const prefs = await getPreferences();
  return resolveModel(prefs.jobAnalysisModel, MODEL_LUNA);
}

export async function getSupportModel(): Promise<string> {
  const prefs = await getPreferences();
  return resolveModel(prefs.supportModel, MODEL_LUNA);
}

/** Outreach message to a recruiter/hiring contact (`features/openai/outreach-message.ts`) — goes straight out to a real person, same stakes as a cover letter. */
export async function getOutreachModel(): Promise<string> {
  const prefs = await getPreferences();
  return resolveModel(prefs.outreachModel, MODEL_TERRA);
}

/**
 * Which Claude tier answers a call made with OpenAI `model` if it falls back: the main one for
 * the models the user picked for application text (cover letter, outreach) or the strong
 * built-in ones, support for everything else.
 */
export async function tierForModel(model: string): Promise<AiTier> {
  if (model === MODEL_TERRA || model === MODEL_ASTRA) return "main";
  try {
    const prefs = await getPreferences();
    const main = [resolveModel(prefs.coverLetterModel, MODEL_TERRA), resolveModel(prefs.outreachModel, MODEL_TERRA)];
    return main.includes(model) ? "main" : "support";
  } catch {
    return "support";
  }
}

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

interface JsonSchemaRequest<T> {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
  /** `reasoning.effort` — "low" for mechanical support steps (parsing, short suggestions) that don't gain from long thinking. Absent = the model's default. */
  reasoningEffort?: ReasoningEffort;
  /** Used only to make failures easier to diagnose; never logged in production. */
  parse: (raw: string) => T;
  /** Hard time budget; past it the call fails with an `OpenAiTimeoutError`. Absent = no limit. */
  timeoutMs?: number;
  /** Names the call in a timeout error ("Parsing search results timed out after 30 s."). */
  label?: string;
  signal?: AbortSignal;
}

interface ResponsesApiOutput {
  output: {
    type: string;
    content?: { type: string; text?: string }[];
  }[];
}

/**
 * POSTs one Responses API body, retrying 429/5xx and network failures with exponential back-off
 * (`retry.ts`); a network failure that outlasts the retries becomes an `OpenAiNetworkError`.
 * With `reasoningEffort`, a 400 that names the `reasoning` parameter (a model picked in Settings
 * that doesn't reason) is retried once without it, so a speed hint can never fail the request.
 */
async function postResponses(apiKey: string, body: Record<string, unknown>, reasoningEffort?: ReasoningEffort, signal?: AbortSignal): Promise<Response> {
  const send = async (payload: Record<string, unknown>) => {
    try {
      return await fetchWithRetry(
        () =>
          fetch(RESPONSES_URL, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(payload),
            signal,
          }),
        {
          signal,
          onRetry: ({ attempt, delayMs, status }) =>
            console.warn(`[Filler] OpenAI ${status ?? "network error"} — retry ${attempt} in ${Math.round(delayMs / 100) / 10} s.`),
        },
      );
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) throw err;
      throw new OpenAiNetworkError(err);
    }
  };
  if (!reasoningEffort) return send(body);
  const res = await send({ ...body, reasoning: { effort: reasoningEffort } });
  if (res.status !== 400) return res;
  const error = await res.clone().text().catch(() => "");
  return /reasoning/i.test(error) ? send(body) : res;
}

/**
 * One abort signal for a call: the caller's own `signal`, plus a hard `timeoutMs`
 * budget and (for streams) an `idleMs` gap with no data. `touch()` restarts the idle
 * timer; `error(err)` turns our own abort into an `OpenAiTimeoutError` naming `what`.
 */
export function callDeadline(what: string, options: { signal?: AbortSignal; timeoutMs?: number; idleMs?: number }) {
  const controller = new AbortController();
  let reason: OpenAiTimeoutError | null = null;
  const abort = (err: OpenAiTimeoutError) => {
    reason ??= err;
    controller.abort(err);
  };
  const { timeoutMs, idleMs } = options;
  const total = timeoutMs ? setTimeout(() => abort(new OpenAiTimeoutError(what, Math.round(timeoutMs / 1000))), timeoutMs) : undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => abort(new OpenAiTimeoutError(`${what} (no data)`, Math.round(idleMs / 1000))), idleMs);
  };
  const onOuterAbort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) controller.abort(options.signal.reason);
  else options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  touch();
  return {
    signal: controller.signal,
    touch,
    error: (err: unknown): unknown => reason ?? err,
    done: () => {
      clearTimeout(total);
      clearTimeout(idle);
      options.signal?.removeEventListener("abort", onOuterAbort);
    },
  };
}

/**
 * All AI requests go straight from the extension to OpenAI with the user's
 * own key (spec sections 3, 15, 21) via the Responses API — OpenAI's
 * current default surface for structured outputs (Chat Completions'
 * `response_format` maps to `text.format` here). The key never leaves
 * extension runtime except as the Authorization header of this exact call.
 */
export async function requestStructured<T>(request: JsonSchemaRequest<T>): Promise<T> {
  const model = request.model ?? (await getSupportModel());

  // One budget for the whole call — OpenAI's retries and a Claude fallback included.
  const deadline = callDeadline(request.label ?? "OpenAI request", { signal: request.signal, timeoutMs: request.timeoutMs });
  try {
    return await withClaudeFallback({
      tier: await tierForModel(model),
      label: request.label,
      openai: async () => {
        const apiKey = await getOpenAiApiKey();
        if (!apiKey) throw new MissingApiKeyError();
        return requestStructuredOnce(request, apiKey, model, deadline.signal);
      },
      claude: (apiKey, claudeModel) =>
        claudeStructured({
          apiKey,
          model: claudeModel,
          system: request.systemPrompt,
          user: request.userPrompt,
          schema: request.schema,
          parse: request.parse,
          effort: claudeEffort(request.reasoningEffort),
          signal: deadline.signal,
        }),
    });
  } catch (err) {
    throw deadline.error(err);
  } finally {
    deadline.done();
  }
}

async function requestStructuredOnce<T>(request: JsonSchemaRequest<T>, apiKey: string, model: string, signal: AbortSignal): Promise<T> {
  const res = await postResponses(
    apiKey,
    {
      model,
      input: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userPrompt },
      ],
      text: {
        format: {
          type: "json_schema",
          name: request.schemaName,
          strict: true,
          schema: request.schema,
        },
      },
    },
    request.reasoningEffort,
    signal,
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiError(`OpenAI request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as ResponsesApiOutput;
  const message = data.output.find((item) => item.type === "message");
  const raw = message?.content?.find((c) => c.type === "output_text")?.text;
  if (!raw) throw new OpenAiError("OpenAI response had no content.");
  return request.parse(raw);
}

interface StreamEvent {
  type?: string;
  delta?: string;
  /** On `error` / `response.failed` events. */
  message?: string;
  response?: { error?: { message?: string } };
}

/**
 * Reads a Responses API SSE stream (`response.output_text.delta` events), calling `onDelta`
 * for each chunk as it arrives and returning the fully assembled text once the stream ends.
 * A failure reported mid-stream (`error` / `response.failed`) is thrown.
 */
async function readOutputTextStream(body: ReadableStream<Uint8Array>, onDelta: (delta: string) => void, onChunk?: () => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk?.();
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; a frame may still be split across two
    // `reader.read()` chunks, so only consume complete frames and keep the remainder buffered.
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const payload = dataLine.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let event: StreamEvent;
      try {
        event = JSON.parse(payload) as StreamEvent;
      } catch {
        continue;
      }
      if (event.type === "error" || event.type === "response.failed") {
        const reason = event.message ?? event.response?.error?.message ?? "unknown error";
        throw new OpenAiError(`OpenAI streaming request failed: ${reason}`);
      }
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        full += event.delta;
        onDelta(event.delta);
      }
    }
  }

  return full;
}

/**
 * spec_5 section C: a plain-text Responses API call with OpenAI's hosted
 * `web_search` tool enabled, so the model can search the live internet
 * before answering — used to find current job postings. Streamed, so the
 * caller can show each posting as soon as the model has written it instead
 * of waiting for the whole answer (`job-search/openai-provider.ts` asks for
 * one JSON object per line for exactly that). Deliberately no strict
 * `text.format: json_schema`: combining it with `tools` isn't a
 * documented-safe combination, and a partial JSON document can't be read
 * mid-stream anyway. Returns "" when the model wrote nothing.
 *
 * Bounded: `timeoutMs`/`idleMs` abort it with an `OpenAiTimeoutError`, and a
 * 429/5xx or network failure before the stream starts is retried with back-off.
 * If OpenAI still fails before any text arrived, Claude's own web search answers
 * (per the fallback policy).
 */
export interface WebSearchStreamOptions {
  model?: string;
  /** At the model's default effort web search runs ~10 searches (~50 s); "low" runs 1-3 (~10-20 s). */
  reasoningEffort?: ReasoningEffort;
  /** Hard budget for the whole call. */
  timeoutMs?: number;
  /** Longest gap with no streamed data (the model searching or thinking). */
  idleMs?: number;
  signal?: AbortSignal;
}

export async function streamWithWebSearch(prompt: string, onDelta: (delta: string) => void, options: WebSearchStreamOptions = {}): Promise<string> {
  const resolvedModel = options.model ?? (await getSupportModel());
  const body = {
    model: resolvedModel,
    stream: true,
    tools: [{ type: "web_search" }],
    input: [{ role: "user", content: prompt }],
  };

  const deadline = callDeadline("OpenAI web search", options);
  let streamed = false;
  const emit = (delta: string) => {
    streamed = true;
    onDelta(delta);
  };
  try {
    return await withClaudeFallback({
      tier: "support",
      label: "Web search",
      canFallBack: () => !streamed,
      openai: async () => {
        const apiKey = await getOpenAiApiKey();
        if (!apiKey) throw new MissingApiKeyError();
        const res = await postResponses(apiKey, body, options.reasoningEffort, deadline.signal);
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          throw new OpenAiError(`OpenAI web search request failed (${res.status}): ${text.slice(0, 300)}`, res.status);
        }
        deadline.touch();
        return readOutputTextStream(res.body, emit, deadline.touch);
      },
      claude: (apiKey, model) => {
        deadline.touch();
        return claudeWebSearchStream({
          apiKey,
          model,
          system: "",
          user: prompt,
          effort: claudeEffort(options.reasoningEffort),
          signal: deadline.signal,
          onDelta: emit,
          onChunk: deadline.touch,
        });
      },
    });
  } catch (err) {
    throw deadline.error(err);
  } finally {
    deadline.done();
  }
}

/**
 * Streaming counterpart to `requestStructured`, for the one call whose output the user watches
 * appear live (cover-letter generation) — deliberately plain text, not `text.format:
 * json_schema`: a partial JSON string fragment can't be shown mid-stream, so this drops the
 * schema wrapper entirely rather than trying to stream valid-but-incomplete JSON
 * (`readOutputTextStream` does the SSE parsing).
 */
export async function requestTextStream(
  systemPrompt: string,
  userPrompt: string,
  onDelta: (delta: string) => void,
  model?: string,
): Promise<string> {
  const resolvedModel = model ?? (await getCoverLetterModel());
  let streamed = false;
  const emit = (delta: string) => {
    streamed = true;
    onDelta(delta);
  };

  const full = await withClaudeFallback({
    tier: await tierForModel(resolvedModel),
    label: "Cover letter",
    // Retries and the fallback only before the first word reached the user — text shown can't be taken back.
    canFallBack: () => !streamed,
    openai: async () => {
      const apiKey = await getOpenAiApiKey();
      if (!apiKey) throw new MissingApiKeyError();
      const res = await postResponses(apiKey, {
        model: resolvedModel,
        stream: true,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });
      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        throw new OpenAiError(`OpenAI streaming request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
      }
      return readOutputTextStream(res.body, emit);
    },
    claude: (apiKey, claudeModel) => claudeTextStream({ apiKey, model: claudeModel, system: systemPrompt, user: userPrompt, onDelta: emit }),
  });
  if (!full) throw new OpenAiError("Streaming response had no content.");
  return full;
}
