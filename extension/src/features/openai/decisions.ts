import { getOpenAiApiKey } from "@/features/storage/local";
import { MODEL_LUNA, MissingApiKeyError, OpenAiError } from "./client";

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
 * One Decisions request with the user's own key — same key handling and error shape as
 * `requestStructured`. More than 400 questions are split across parallel requests.
 */
export async function requestDecisions(request: DecisionRequest): Promise<DecisionAnswers> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new MissingApiKeyError();
  const answers: DecisionAnswers = new Map();
  if (request.questions.length === 0) return answers;

  const batches: DecisionQuestion[][] = [];
  for (let i = 0; i < request.questions.length; i += MAX_QUESTIONS) batches.push(request.questions.slice(i, i + MAX_QUESTIONS));

  const results = await Promise.all(
    batches.map(async (questions) => {
      const res = await fetch(DECISIONS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: MODEL_LUNA,
          input: request.input,
          questions,
          ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
        }),
        signal: request.signal,
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
