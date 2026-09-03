import type { RuntimeMessage } from "@/types/messages";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { PageCheckbox } from "@/features/autofill/checkboxes";
import { getProfile } from "@/features/profile/repository";
import { setLocal } from "@/features/storage/local";
import { runCoverLetterPipeline } from "@/features/cover-letter/pipeline";
import { extractJobWithAi } from "@/features/job-extraction/ai-fallback";
import { reviseCoverLetter } from "@/features/openai/revise-cover-letter";
import { translateCoverLetter } from "@/features/openai/translate-cover-letter";
import { answerCustomQuestion } from "@/features/openai/answer-question";
import { decomposeBlock } from "@/features/openai/decompose-block";
import { decideCheckboxes } from "@/features/openai/decide-checkboxes";
import { detectJobLanguage } from "@/features/openai/detect-job-language";
import { ensureContentScript } from "./inject-content-script";

/**
 * Sends `message` to every frame in `frameIds` (not just the main frame —
 * `tabs.sendMessage` without a `frameId` only ever reaches frame 0) and
 * returns whatever each frame answered, dropping frames that didn't respond
 * (restricted subframe, no content script reached it, etc).
 * Extraction/autofill/question-detection all need this: the actual
 * application form frequently lives inside an embedded ATS iframe, not the
 * top document.
 */
/** Tell every frame's element picker to dismiss its overlay. Also used when the Side Panel port disconnects. */
export async function cancelElementPicker(tabId: number): Promise<void> {
  const frameIds = await ensureContentScript(tabId);
  await Promise.all(
    frameIds.map((frameId) =>
      chrome.tabs
        .sendMessage(tabId, { type: "CANCEL_ELEMENT_PICKER", tabId } satisfies RuntimeMessage, { frameId })
        .catch(() => undefined),
    ),
  );
}

async function sendToFrames(tabId: number, frameIds: number[], message: RuntimeMessage): Promise<RuntimeMessage[]> {
  const responses = await Promise.all(
    frameIds.map((frameId) =>
      chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => undefined) as Promise<
        RuntimeMessage | undefined
      >,
    ),
  );
  return responses.filter((r): r is RuntimeMessage => Boolean(r));
}

/**
 * Background owns message routing between Side Panel and Content Script
 * (spec section 22). Requests that target a specific tab carry an explicit
 * `tabId` from the Side Panel (which tracks the active tab itself via
 * `useActiveTab`) rather than this module re-querying "the active tab" —
 * that avoids attributing a slow response to whichever tab happens to be
 * active by the time it resolves, if the user switched tabs meanwhile.
 */
export async function routeMessage(message: RuntimeMessage): Promise<RuntimeMessage | undefined> {
  switch (message.type) {
    case "GET_PROFILE": {
      const profile = await getProfile();
      return { type: "PROFILE_DATA", profile };
    }

    case "GET_JOB": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const jobResponses = responses.filter(
        (r): r is Extract<RuntimeMessage, { type: "JOB_DATA" }> => r.type === "JOB_DATA",
      );
      if (jobResponses.length === 0) return undefined;

      const sufficient = jobResponses.find((r) => r.sufficient);
      if (sufficient) return sufficient;

      // No single frame had enough signal on its own — a job's description
      // commonly lives in a different frame than its title/company header
      // (e.g. an embedded ATS widget under a career-page shell). Combine
      // every frame's visible text before falling back to the AI pass.
      const best = jobResponses.reduce((a, b) => (b.job.description.length > a.job.description.length ? b : a));
      const combinedText = jobResponses
        .map((r) => r.visibleText ?? "")
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 20000);

      try {
        const aiJob = await extractJobWithAi(combinedText || best.visibleText || "", best.job.url);
        return { type: "JOB_DATA", job: aiJob, sufficient: true };
      } catch {
        // AI fallback failed (e.g. no API key yet) — surface the partial DOM extraction.
        return best;
      }
    }

    case "EXTRACT_JOB_FROM_TEXT": {
      const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      const job = await extractJobWithAi(message.text, tab?.url ?? "");
      return { type: "JOB_DATA", job, sufficient: true };
    }

    case "AUTOFILL": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const results = responses.filter(
        (r): r is Extract<RuntimeMessage, { type: "AUTOFILL_RESULT" }> => r.type === "AUTOFILL_RESULT",
      );
      return {
        type: "AUTOFILL_RESULT",
        filled: results.reduce((sum, r) => sum + r.filled, 0),
        total: results.reduce((sum, r) => sum + r.total, 0),
        generatedPassword: results.map((r) => r.generatedPassword).find(Boolean) ?? null,
      };
    }

    case "GENERATE_COVER_LETTER": {
      const result = await runCoverLetterPipeline(message.job);
      await setLocal("lastCoverLetter", result.content);
      return {
        type: "COVER_LETTER_RESULT",
        content: result.content,
        slopFindings: result.slopFindings,
        cleaned: result.cleaned,
      };
    }

    case "UPLOAD_FILE": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const results = responses.filter(
        (r): r is Extract<RuntimeMessage, { type: "UPLOAD_FILE_RESULT" }> => r.type === "UPLOAD_FILE_RESULT",
      );
      return {
        type: "UPLOAD_FILE_RESULT",
        nativeInputs: results.reduce((sum, r) => sum + r.nativeInputs, 0),
        dropZones: results.reduce((sum, r) => sum + r.dropZones, 0),
      };
    }

    case "REVISE_COVER_LETTER": {
      const content = await reviseCoverLetter(message.content, message.instructions, message.job);
      await setLocal("lastCoverLetter", content);
      return { type: "REVISE_COVER_LETTER_RESULT", content };
    }

    case "TRANSLATE_COVER_LETTER": {
      const content = await translateCoverLetter(message.content, message.targetLanguage);
      return { type: "TRANSLATE_COVER_LETTER_RESULT", content };
    }

    case "DETECT_CUSTOM_QUESTIONS": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const seen = new Set<string>();
      const questions: CustomQuestion[] = [];
      for (const r of responses) {
        if (r.type !== "CUSTOM_QUESTIONS_DATA") continue;
        for (const q of r.questions) {
          if (seen.has(q.question)) continue;
          seen.add(q.question);
          questions.push({ ...q, id: `question-${questions.length}` });
        }
      }
      return { type: "CUSTOM_QUESTIONS_DATA", questions };
    }

    case "ANSWER_CUSTOM_QUESTION": {
      const answer = await answerCustomQuestion(message.question, message.job, message.options);
      return { type: "CUSTOM_QUESTION_ANSWER", question: message.question, answer };
    }

    case "FILL_CUSTOM_QUESTION_ANSWERS": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      let filled = 0;
      for (const r of responses) {
        if (r.type === "CUSTOM_QUESTION_FILL_RESULT") filled += r.filled;
      }
      return { type: "CUSTOM_QUESTION_FILL_RESULT", filled };
    }

    case "START_ELEMENT_PICKER": {
      // Every frame gets its own overlay (the application form is often
      // inside an embedded ATS iframe, not the top document). The first
      // frame to report a real pick wins; the rest are then dismissed.
      const frameIds = await ensureContentScript(message.tabId);
      const framePicks = frameIds.map(
        (frameId) =>
          chrome.tabs.sendMessage(message.tabId, message, { frameId }).catch(() => undefined) as Promise<
            Extract<RuntimeMessage, { type: "ELEMENT_PICKER_RESULT" }> | undefined
          >,
      );

      const winner = await new Promise<Extract<RuntimeMessage, { type: "ELEMENT_PICKER_RESULT" }> | undefined>(
        (resolve) => {
          let pending = framePicks.length;
          if (pending === 0) resolve(undefined);
          for (const pick of framePicks) {
            void pick.then((result) => {
              pending -= 1;
              // A real pick wins immediately; a `cancelled` result means the
              // user pressed Esc in some frame (we haven't sent CANCEL yet),
              // so end the mode. `undefined` is just a frame with no picker —
              // it only counts down `pending`.
              if (result && !result.cancelled && result.picked.length > 0) resolve(result);
              else if (result?.cancelled) resolve(result);
              else if (pending === 0) resolve(result ?? undefined);
            });
          }
        },
      );

      await Promise.all(
        frameIds.map((frameId) =>
          chrome.tabs
            .sendMessage(message.tabId, { type: "CANCEL_ELEMENT_PICKER", tabId: message.tabId }, { frameId })
            .catch(() => undefined),
        ),
      );

      return (
        winner ?? { type: "ELEMENT_PICKER_RESULT", cancelled: true, picked: [], blockText: "", semanticCount: 0 }
      );
    }

    case "CANCEL_ELEMENT_PICKER": {
      await cancelElementPicker(message.tabId);
      return undefined;
    }

    case "DECOMPOSE_BLOCK": {
      const questions = await decomposeBlock(message.blockText, message.fields);
      return { type: "BLOCK_QUESTIONS", questions };
    }

    case "FILL_QUESTION_ANSWERS_BY_LOCATOR": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      let filled = 0;
      for (const r of responses) {
        if (r.type === "CUSTOM_QUESTION_FILL_RESULT") filled += r.filled;
      }
      return { type: "CUSTOM_QUESTION_FILL_RESULT", filled };
    }

    case "DETECT_CHECKBOXES": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const seen = new Set<string>();
      const checkboxes: PageCheckbox[] = [];
      for (const r of responses) {
        if (r.type !== "CHECKBOXES_DATA") continue;
        for (const checkbox of r.checkboxes) {
          const dedupeKey = checkbox.name || checkbox.label;
          if (!dedupeKey || seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          checkboxes.push({ ...checkbox, id: `checkbox-${checkboxes.length}` });
        }
      }
      return { type: "CHECKBOXES_DATA", checkboxes };
    }

    case "DECIDE_CHECKBOXES": {
      const decisions = await decideCheckboxes(message.checkboxes);
      return { type: "CHECKBOX_DECISIONS", decisions };
    }

    case "APPLY_CHECKBOX_DECISIONS": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      let changed = 0;
      for (const r of responses) {
        if (r.type === "CHECKBOX_APPLY_RESULT") changed += r.changed;
      }
      return { type: "CHECKBOX_APPLY_RESULT", changed };
    }

    case "DETECT_JOB_LANGUAGE": {
      const info = await detectJobLanguage(message.job);
      return { type: "JOB_LANGUAGE_DATA", info };
    }

    default:
      return undefined;
  }
}
