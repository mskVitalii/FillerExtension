import { getOpenAiApiKey } from "@/features/storage/local";

const RESPONSES_URL = "https://api.openai.com/v1/responses";

/** High-quality model — used for text that goes straight into the application (spec_2 item 4). */
export const MODEL_TERRA = "gpt-5.6-terra";
/** Smaller/faster model — used for support tasks (analysis, translation) where latency matters more than nuance. */
export const MODEL_LUNA = "gpt-5.6-luna";
const DEFAULT_MODEL = MODEL_TERRA;

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

  const res = await fetch(RESPONSES_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: request.model ?? DEFAULT_MODEL,
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
