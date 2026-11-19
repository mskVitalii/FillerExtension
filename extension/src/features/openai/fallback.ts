import { getAnthropicApiKey } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { CLAUDE_MODEL_MAIN, CLAUDE_MODEL_SUPPORT, isClaudeModel } from "./anthropic";
import { MissingApiKeyError, OpenAiError, OpenAiNetworkError, OpenAiTimeoutError } from "./errors";
import { isAbortError, isRetryableStatus } from "./retry";

/**
 * When an OpenAI call (after its own retries) fails, whether to answer it with Claude instead:
 * - `off` — never;
 * - `unavailable` — only when OpenAI is overloaded or unreachable: 429, 5xx, a network error;
 * - `any` — on any OpenAI API error (a bad or missing key, quota, an invalid request…);
 * - `always` — Claude is the primary provider; OpenAI isn't called at all.
 * Every policy needs an Anthropic key; without one OpenAI's error is shown as before.
 */
export type AiFallbackPolicy = "off" | "unavailable" | "any" | "always";
export const AI_FALLBACK_POLICIES: readonly AiFallbackPolicy[] = ["off", "unavailable", "any", "always"];
export const DEFAULT_AI_FALLBACK_POLICY: AiFallbackPolicy = "unavailable";

/** Which Claude model answers for a call: the main tier (text that goes into the application) or support. */
export type AiTier = "main" | "support";

export interface FallbackSettings {
  policy: AiFallbackPolicy;
  apiKey: string;
  models: Record<AiTier, string>;
}

/** Settings → AI fallback. Any storage failure reads as "off", so a fallback can never break the OpenAI path. */
export async function getFallbackSettings(): Promise<FallbackSettings> {
  try {
    const [prefs, apiKey] = await Promise.all([getPreferences(), getAnthropicApiKey()]);
    const policy = AI_FALLBACK_POLICIES.includes(prefs.aiFallbackPolicy) ? prefs.aiFallbackPolicy : DEFAULT_AI_FALLBACK_POLICY;
    return {
      policy,
      apiKey: apiKey ?? "",
      models: {
        main: prefs.claudeMainModel && isClaudeModel(prefs.claudeMainModel) ? prefs.claudeMainModel : CLAUDE_MODEL_MAIN,
        support: prefs.claudeSupportModel && isClaudeModel(prefs.claudeSupportModel) ? prefs.claudeSupportModel : CLAUDE_MODEL_SUPPORT,
      },
    };
  } catch {
    return { policy: "off", apiKey: "", models: { main: CLAUDE_MODEL_MAIN, support: CLAUDE_MODEL_SUPPORT } };
  }
}

/** Is OpenAI overloaded or unreachable (as opposed to rejecting the request)? */
export function isOpenAiUnavailable(err: unknown): boolean {
  if (err instanceof OpenAiNetworkError) return true;
  return err instanceof OpenAiError && typeof err.status === "number" && isRetryableStatus(err.status);
}

/**
 * Whether `err` from OpenAI should be answered by Claude under `policy`. Never for the user's own
 * abort or a call's time budget running out (the budget covers the fallback too), and never for
 * an error that isn't OpenAI's (a parse failure of our own).
 */
export function shouldFallBack(policy: AiFallbackPolicy, err: unknown): boolean {
  if (policy === "off" || isAbortError(err) || err instanceof OpenAiTimeoutError) return false;
  if (!(err instanceof OpenAiError)) return false;
  if (policy === "unavailable") return isOpenAiUnavailable(err);
  return true;
}

export interface FallbackNotice {
  /** ISO time the fallback answered. */
  at: string;
  model: string;
  /** Short reason: "OpenAI 503", "OpenAI unreachable", … */
  reason: string;
  /** Names the call ("Cover letter"), when the caller gave one. */
  label?: string;
}

type FallbackListener = (notice: FallbackNotice) => void;
const listeners = new Set<FallbackListener>();

/** Subscribes to fallbacks in this context (the agent logs them per job). Returns the unsubscribe. */
export function onAiFallback(listener: FallbackListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Session key the Side Panel watches to show "answered by Claude". */
export const FALLBACK_NOTICE_KEY = "aiFallbackNotice";

export function describeFailure(err: unknown): string {
  if (err instanceof MissingApiKeyError) return "no OpenAI key";
  if (err instanceof OpenAiNetworkError) return "OpenAI unreachable";
  if (err instanceof OpenAiError && err.status) return `OpenAI ${err.status}`;
  return "OpenAI error";
}

/** Tells listeners, the console and the Side Panel that `notice.model` answered instead of OpenAI. */
export async function announceAiFallback(notice: FallbackNotice): Promise<void> {
  console.warn(`[Filler] ${notice.label ? `${notice.label}: ` : ""}answered by ${notice.model} (${notice.reason}).`);
  for (const listener of listeners) {
    try {
      listener(notice);
    } catch {
      /* a listener's failure never fails the call */
    }
  }
  try {
    await chrome.storage.session.set({ [FALLBACK_NOTICE_KEY]: notice });
  } catch {
    /* no session storage (tests) — the console line is enough */
  }
}

/**
 * Runs `openai`, and answers with `claude(apiKey, model)` instead when the policy says so: before
 * OpenAI is tried (`always`), or after it failed with an error `shouldFallBack` accepts.
 * `canFallBack` lets a stream refuse once its output started (the text can't be taken back).
 */
export async function withClaudeFallback<T>(options: {
  tier: AiTier;
  label?: string;
  openai: () => Promise<T>;
  claude: (apiKey: string, model: string) => Promise<T>;
  canFallBack?: () => boolean;
}): Promise<T> {
  const settings = await getFallbackSettings();
  const usable = settings.policy !== "off" && !!settings.apiKey;
  const model = settings.models[options.tier];
  // The user's own choice, not a fallback — nothing to announce.
  if (usable && settings.policy === "always") return options.claude(settings.apiKey, model);
  try {
    return await options.openai();
  } catch (err) {
    if (!usable || !shouldFallBack(settings.policy, err) || (options.canFallBack && !options.canFallBack())) throw err;
    const result = await options.claude(settings.apiKey, model);
    void announceAiFallback({ at: new Date().toISOString(), model, reason: describeFailure(err), label: options.label }).catch(() => {});
    return result;
  }
}
