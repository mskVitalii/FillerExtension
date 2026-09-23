import { getOpenAiApiKey } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

/** High-quality model — used for text that goes straight into the application (spec_2 item 4). */
export const MODEL_TERRA = "gpt-5.6-terra";
/** Smaller/faster model — used for support tasks (analysis, translation) where latency matters more than nuance. */
export const MODEL_LUNA = "gpt-5.6-luna";
export const MODEL_SOL = "gpt-5.6-sol";
export const MODEL_ASTRA = "gpt-5.6-astra";

export const AVAILABLE_MODELS = [MODEL_TERRA, MODEL_LUNA, MODEL_SOL, MODEL_ASTRA] as const;
export type AiModel = (typeof AVAILABLE_MODELS)[number];

/**
 * Resolves which model each tier actually calls, honoring the user's choice
 * from Settings (`Preferences.coverLetterModel`/`extractionModel`/
 * `jobAnalysisModel`/`supportModel`, an empty string meaning "not chosen
 * yet") and otherwise falling back to the tier's built-in default.
 */
export async function getCoverLetterModel(): Promise<string> {
  const prefs = await getPreferences();
  return prefs.coverLetterModel || MODEL_TERRA;
}

/** Job-posting extraction from raw page/pasted text (`features/job-extraction/ai-fallback.ts`). */
export async function getExtractionModel(): Promise<string> {
  const prefs = await getPreferences();
  return prefs.extractionModel || MODEL_LUNA;
}

/** Analysis of an already-extracted job posting (`job-analysis.ts`, `analyze-job-brief.ts`). */
export async function getJobAnalysisModel(): Promise<string> {
  const prefs = await getPreferences();
  return prefs.jobAnalysisModel || MODEL_LUNA;
}

export async function getSupportModel(): Promise<string> {
  const prefs = await getPreferences();
  return prefs.supportModel || MODEL_LUNA;
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

interface JsonSchemaRequest<T> {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
  model?: string;
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

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
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
    }),
  });

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

/**
 * spec_5 section C: a plain-text Responses API call with OpenAI's hosted
 * `web_search` tool enabled, so the model can search the live internet
 * before answering — used to find current job postings. Deliberately
 * separate from `requestStructured`: combining `tools` and a strict
 * `text.format: json_schema` in the same call isn't a documented-safe
 * combination, so the caller runs this first for raw, citation-bearing
 * text, then a second ordinary `requestStructured` call (no tools) to
 * parse that text into the app's normalized job-listing shape.
 */
export async function requestWithWebSearch(prompt: string, model?: string): Promise<string> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const resolvedModel = model ?? (await getSupportModel());

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: resolvedModel,
      tools: [{ type: "web_search" }],
      input: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OpenAiError(`OpenAI web search request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as ResponsesApiOutput;
  const message = data.output.find((item) => item.type === "message");
  const raw = message?.content?.find((c) => c.type === "output_text")?.text;
  if (!raw) throw new OpenAiError("OpenAI web search response had no content.");
  return raw;
}

interface StreamEvent {
  type?: string;
  delta?: string;
}

/**
 * Streaming counterpart to `requestStructured`, for the one call whose output the user watches
 * appear live (cover-letter generation) — deliberately plain text, not `text.format:
 * json_schema`: a partial JSON string fragment can't be shown mid-stream, so this drops the
 * schema wrapper entirely rather than trying to stream valid-but-incomplete JSON. Parses the
 * Responses API's SSE stream directly (`response.output_text.delta` events), calling `onDelta`
 * for each chunk as it arrives and returning the fully assembled text once the stream ends.
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

  const reader = res.body.getReader();
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
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        full += event.delta;
        onDelta(event.delta);
      }
    }
  }

  if (!full) throw new OpenAiError("OpenAI streaming response had no content.");
  return full;
}
