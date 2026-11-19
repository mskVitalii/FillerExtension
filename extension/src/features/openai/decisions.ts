import { getOpenAiApiKey } from "@/features/storage/local";
import { claudeStructured } from "./anthropic";
import { MODEL_LUNA, MissingApiKeyError, OpenAiError, OpenAiNetworkError } from "./client";
import { withClaudeFallback } from "./fallback";
import { fetchWithRetry, isAbortError } from "./retry";

/**
 * OpenAI's Decisions API (`POST /v1/decisions`, developers.openai.com/api/docs/guides/decisions):
 * typed answers — a probability, a choice from a fixed set, or a score on a rubric — instead of
 * generated text, about 10x faster than the Responses API and with free output. Used for the
 * classification-shaped calls (consent checkboxes, option questions, "do we know enough to
 * answer this", which CV). Anything that has to *write* text stays on the Responses API.
 * Only `gpt-6-luna` is supported. Questions in one request can't depend on each other.
 */

const DECISIONS_URL = "https://api.openai.com/v1/decisions";

/**
 * Every confidence cut-off in one place. Below a threshold the answer goes to the user
 * (left unfilled, "needs you") instead of onto the page.
 */
export const DECISION_THRESHOLDS = {
  /** A consent checkbox is ticked when P(should be checked) reaches this. */
  checkboxCheck: 0.5,
  /** Below this category confidence, a checkbox's category is reported as "unclear". */
  checkboxCategory: 0.5,
  /** A single-choice option question is filled only when the choice's confidence reaches this. */
  optionChoice: 0.55,
  /** A select-all option is picked when its P(applies) reaches this… */
  multiOptionPick: 0.5,
  /** …and the whole answer goes to the user when any option sits closer than this to 0.5 (genuinely unsure). */
  multiOptionMargin: 0.2,
  /** A free-text question is generated only when P(the applicant's data covers it) reaches this. */
  factsAvailable: 0.35,
  /** The AI's CV pick replaces the offline one only at this confidence or above. */
  cvChoice: 0.5,
} as const;

export interface DecisionChoiceOption {
  value: string;
  description?: string;
}

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: DecisionChoiceOption[] }
  | { type: "score"; name: string; instructions: string; levels: { label: string; description?: string }[] };

export type DecisionAnswer =
  | { type: "predicate"; name: string; probability: number }
  | {
      type: "choice";
      name: string;
      choice: string;
      probabilities: { value: string; probability: number }[];
      confidence: number;
    }
  | {
      type: "score";
      name: string;
      score: number;
      probabilities: { value: number; label: string; probability: number }[];
      confidence: number;
    }
  | { type: "refusal"; name: string; refusal?: string };

type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_json"; data: unknown };

export type DecisionInput = string | { role: "developer" | "user"; content: string | InputContent[] }[];

export interface DecisionRequest {
  input: DecisionInput;
  questions: DecisionQuestion[];
  /** Partitions prompt-cache reuse; the shared `input` prefix needs ≥1024 tokens to be cached. */
  promptCacheKey?: string;
  signal?: AbortSignal;
}

/** Answers keyed by question `name`. A question the API didn't answer is simply absent. */
export type DecisionAnswers = Map<string, DecisionAnswer>;

const MAX_QUESTIONS = 400;

/**
 * One Decisions request with the user's own key — same key handling, retries and error shape as
 * `requestStructured`. More than 400 questions are split across parallel requests. When OpenAI
 * fails and the fallback policy allows it, Claude answers the same questions (`decideWithClaude`).
 */
export async function requestDecisions(request: DecisionRequest): Promise<DecisionAnswers> {
  if (request.questions.length === 0) return new Map();
  return withClaudeFallback({
    tier: "support",
    label: "Decisions",
    openai: () => requestOpenAiDecisions(request),
    claude: (apiKey, model) => decideWithClaude(request, apiKey, model),
  });
}

async function requestOpenAiDecisions(request: DecisionRequest): Promise<DecisionAnswers> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const answers: DecisionAnswers = new Map();

  const batches: DecisionQuestion[][] = [];
  for (let i = 0; i < request.questions.length; i += MAX_QUESTIONS) batches.push(request.questions.slice(i, i + MAX_QUESTIONS));

  const results = await Promise.all(
    batches.map(async (questions) => {
      const res = await fetchWithRetry(
        () =>
          fetch(DECISIONS_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: MODEL_LUNA,
              input: request.input,
              questions,
              ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
            }),
            signal: request.signal,
          }),
        { signal: request.signal },
      ).catch((err: unknown) => {
        throw request.signal?.aborted || isAbortError(err) ? err : new OpenAiNetworkError(err);
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new OpenAiError(`OpenAI decisions request failed (${res.status}): ${body.slice(0, 300)}`, res.status);
      }
      const data = (await res.json()) as { answers?: DecisionAnswer[] };
      if (!Array.isArray(data.answers)) throw new OpenAiError("OpenAI decisions response had no answers.");
      return data.answers;
    }),
  );
  for (const answer of results.flat()) {
    if (answer && typeof answer.name === "string") answers.set(answer.name, answer);
  }
  return answers;
}

/** The Decisions request's input as plain text for Claude (JSON parts pretty-printed). */
function inputText(input: DecisionInput): string {
  if (typeof input === "string") return input;
  return input
    .map((message) => {
      const content =
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "input_text" ? part.text : JSON.stringify(part.data, null, 2))).join("\n\n");
      return message.role === "developer" ? `Instructions:\n${content}` : content;
    })
    .join("\n\n");
}

function describeQuestion(question: DecisionQuestion): string {
  const lines = [`## ${question.name} (${question.type})`, question.instructions];
  if (question.type === "choice") lines.push(...question.choices.map((c) => `- ${c.value}${c.description ? `: ${c.description}` : ""}`));
  if (question.type === "score") lines.push(...question.levels.map((l, i) => `- ${i + 1}. ${l.label}${l.description ? `: ${l.description}` : ""}`));
  return lines.join("\n");
}

const PROBABILITY = { type: "number", description: "Calibrated probability, 0 to 1." };

function questionSchema(question: DecisionQuestion): Record<string, unknown> {
  const properties: Record<string, unknown> =
    question.type === "predicate"
      ? { probability: { ...PROBABILITY, description: "Probability, 0 to 1, that the answer is yes." } }
      : question.type === "choice"
        ? { choice: { type: "string", enum: question.choices.map((c) => c.value) }, confidence: PROBABILITY }
        : { level: { type: "string", enum: question.levels.map((l) => l.label) }, confidence: PROBABILITY };
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

const clamp01 = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * The Decisions API emulated on Claude: one structured answer with a probability (predicate), a
 * choice plus confidence (choice) or a level plus confidence (score) per question, mapped back to
 * `DecisionAnswer`s. Probabilities come from the model's own estimate, not token log-probs, so
 * they're coarser than OpenAI's — the thresholds above still apply.
 */
export async function decideWithClaude(request: DecisionRequest, apiKey: string, model: string): Promise<DecisionAnswers> {
  const properties = Object.fromEntries(request.questions.map((q) => [q.name, questionSchema(q)]));
  const raw = await claudeStructured({
    apiKey,
    model,
    effort: "low",
    signal: request.signal,
    system:
      "Answer every question below about the given material. Probabilities and confidences are calibrated estimates between 0 and 1: " +
      "0.5 means you genuinely can't tell. Answer each question on its own.",
    user: `${inputText(request.input)}\n\n# Questions\n\n${request.questions.map(describeQuestion).join("\n\n")}`,
    schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
    parse: (text) => JSON.parse(text) as Record<string, { probability?: number; choice?: string; level?: string; confidence?: number }>,
  });
  const answers: DecisionAnswers = new Map();
  for (const question of request.questions) {
    const answer = raw[question.name];
    if (!answer) continue;
    if (question.type === "predicate") {
      answers.set(question.name, { type: "predicate", name: question.name, probability: clamp01(answer.probability) });
    } else if (question.type === "choice" && typeof answer.choice === "string") {
      const confidence = clamp01(answer.confidence);
      const rest = (1 - confidence) / Math.max(1, question.choices.length - 1);
      answers.set(question.name, {
        type: "choice",
        name: question.name,
        choice: answer.choice,
        confidence,
        probabilities: question.choices.map((c) => ({ value: c.value, probability: c.value === answer.choice ? confidence : rest })),
      });
    } else if (question.type === "score" && typeof answer.level === "string") {
      const index = question.levels.findIndex((l) => l.label === answer.level);
      if (index < 0) continue;
      const confidence = clamp01(answer.confidence);
      answers.set(question.name, {
        type: "score",
        name: question.name,
        score: index + 1,
        confidence,
        probabilities: question.levels.map((l, i) => ({ value: i + 1, label: l.label, probability: i === index ? confidence : 0 })),
      });
    }
  }
  return answers;
}

export function predicateProbability(answers: DecisionAnswers, name: string): number | null {
  const answer = answers.get(name);
  return answer?.type === "predicate" && typeof answer.probability === "number" ? answer.probability : null;
}

export function choiceAnswer(answers: DecisionAnswers, name: string): { choice: string; confidence: number } | null {
  const answer = answers.get(name);
  if (answer?.type !== "choice" || typeof answer.choice !== "string") return null;
  return { choice: answer.choice, confidence: typeof answer.confidence === "number" ? answer.confidence : 0 };
}

/** Short, stable, non-cryptographic hash (FNV-1a) — for prompt-cache keys, never for secrets. */
export function stableHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
