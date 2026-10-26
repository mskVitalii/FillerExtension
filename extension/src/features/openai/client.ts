import { getOpenAiApiKey } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";

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
}

interface ResponsesApiOutput {
  output: {
    type: string;
    content?: { type: string; text?: string }[];
  }[];
}

/**
 * POSTs one Responses API body. With `reasoningEffort`, a 400 that names the
 * `reasoning` parameter (a model picked in Settings that doesn't reason) is
 * retried once without it, so a speed hint can never fail the request.
 */
async function postResponses(apiKey: string, body: Record<string, unknown>, reasoningEffort?: ReasoningEffort): Promise<Response> {
  const send = (payload: Record<string, unknown>) =>
    fetch(RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  if (!reasoningEffort) return send(body);
  const res = await send({ ...body, reasoning: { effort: reasoningEffort } });
  if (res.status !== 400) return res;
  const error = await res.clone().text().catch(() => "");
  return /reasoning/i.test(error) ? send(body) : res;
}

/**
 * All AI requests go straight from the extension to OpenAI with the user's
 * own key (spec sections 3, 15, 21) via the Responses API — OpenAI's
 * current default surface for structured outputs (Chat Completions'
 * `response_format` maps to `text.format` here). The key never leaves
 * extension runtime except as the Authorization header of this exact call.
 */
export async function requestStructured<T>(request: JsonSchemaRequest<T>): Promise<T> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const model = request.model ?? (await getSupportModel());

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
async function readOutputTextStream(body: ReadableStream<Uint8Array>, onDelta: (delta: string) => void): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
 */
export async function streamWithWebSearch(prompt: string, onDelta: (delta: string) => void, model?: string): Promise<string> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const resolvedModel = model ?? (await getSupportModel());

  const res = await postResponses(apiKey, {
    model: resolvedModel,
    stream: true,
    tools: [{ type: "web_search" }],
    input: [{ role: "user", content: prompt }],
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new OpenAiError(`OpenAI web search request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }
  return readOutputTextStream(res.body, onDelta);
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
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const resolvedModel = model ?? (await getCoverLetterModel());

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      stream: true,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new OpenAiError(`OpenAI streaming request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }

  const full = await readOutputTextStream(res.body, onDelta);
  if (!full) throw new OpenAiError("OpenAI streaming response had no content.");
  return full;
}
