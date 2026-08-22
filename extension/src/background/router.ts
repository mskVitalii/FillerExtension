import type { RuntimeMessage } from "@/types/messages";
import { getProfile } from "@/features/profile/repository";
import { setLocal } from "@/features/storage/local";
import { runCoverLetterPipeline } from "@/features/cover-letter/pipeline";
import { extractJobWithAi } from "@/features/job-extraction/ai-fallback";

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
      const result = (await chrome.tabs.sendMessage(message.tabId, message)) as RuntimeMessage | undefined;
      if (!result || result.type !== "JOB_DATA") return result;
      if (result.sufficient) return result;

      try {
        const aiJob = await extractJobWithAi(result.visibleText ?? "", result.job.url);
        return { type: "JOB_DATA", job: aiJob, sufficient: true };
      } catch {
        // AI fallback failed (e.g. no API key yet) — surface the partial DOM extraction.
        return result;
      }
    }

    case "EXTRACT_JOB_FROM_TEXT": {
      const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      const job = await extractJobWithAi(message.text, tab?.url ?? "");
      return { type: "JOB_DATA", job, sufficient: true };
    }

    case "AUTOFILL": {
      return (await chrome.tabs.sendMessage(message.tabId, message)) as RuntimeMessage;
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
      return (await chrome.tabs.sendMessage(message.tabId, message)) as RuntimeMessage;
    }

    default:
      return undefined;
  }
}
