import type { RuntimeMessage } from "@/types/messages";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { PageCheckbox } from "@/features/autofill/checkboxes";
import type { JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { getFaqAnswers, getPersonalLegend, getProfile, saveFaqAnswers } from "@/features/profile/repository";
import { fillMissingFaqAnswers } from "@/features/openai/generate-faq";
import { getCachedJob, getJobSearchCredentials, setCachedJob, setLocal } from "@/features/storage/local";
import { searchOpenAiJobs } from "@/features/job-search/openai-provider";
import { searchTavilyJobs } from "@/features/job-search/tavily-provider";
import { searchAdzunaJobs } from "@/features/job-search/adzuna-provider";
import { adzunaCountryCode } from "@/features/job-search/adzuna-country";
import { timeStage } from "@/features/job-search/timing";
import { getSearchSuggestion } from "@/features/job-search/suggestion-cache";
import { runCoverLetterPipeline } from "@/features/cover-letter/pipeline";
import { generateOutreachMessage } from "@/features/openai/outreach-message";
import { getApplicantContext } from "@/features/profile/context";
import { completeJobWithAiAndBrief, extractJobWithAiAndBrief } from "@/features/job-extraction/ai-fallback";
import { reviseCoverLetter } from "@/features/openai/revise-cover-letter";
import { reviseOutreachMessage } from "@/features/openai/revise-outreach-message";
import { translateCoverLetter } from "@/features/openai/translate-cover-letter";
import { answerCustomQuestion } from "@/features/openai/answer-question";
import { decomposeBlock } from "@/features/openai/decompose-block";
import { decidePageContent } from "@/features/openai/decide-page-content";
import { analyzeJobBrief } from "@/features/openai/analyze-job-brief";
import { suggestCvValues } from "@/features/openai/suggest-cv-values";
import { ensureContentScript, findBlockedFrameOrigins } from "./inject-content-script";
import type { ElementLocator } from "@/features/autofill/element-locator";

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

/**
 * Sends `message` to every frame in `frameIds` (not just the main frame —
 * `tabs.sendMessage` without a `frameId` only ever reaches frame 0) and
 * returns whatever each frame answered, dropping frames that didn't respond
 * (restricted subframe, no content script reached it, etc).
 * Extraction/autofill/question-detection all need this: the actual
 * application form frequently lives inside an embedded ATS iframe, not the
 * top document.
 */
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
 * A write-back for one element (a picked field's answer, a file dropped on
 * a field) goes to the frame that element was found in — broadcasting it
 * would let a loose locator match a look-alike field in some other frame.
 * Falls back to every frame when the frame id is unknown (locators cached
 * before frame ids existed) or that frame no longer answers (iframe gone).
 */
async function sendToFrameOrAll(
  tabId: number,
  frameIds: number[],
  frameId: number | undefined,
  message: RuntimeMessage,
): Promise<RuntimeMessage[]> {
  if (frameId !== undefined && frameIds.includes(frameId)) {
    const response = (await chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => undefined)) as
      | RuntimeMessage
      | undefined;
    if (response) return [response];
  }
  return sendToFrames(tabId, frameIds, message);
}

/** Groups items by the frame their locator was stamped with (`undefined` = unknown frame). */
function groupByFrame<T extends { locator: ElementLocator }>(items: T[]): Map<number | undefined, T[]> {
  const groups = new Map<number | undefined, T[]>();
  for (const item of items) {
    const key = item.locator.frameId;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
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
      // Re-opening the panel on a URL already fully determined before — a
      // new tab on the same posting, a browser restart, a bookmark revisited
      // days later — should never re-pay for DOM re-parsing or the AI
      // fallback below; `chrome.storage.session`'s per-tab `TabState` only
      // covers one tab's own lifetime, not this. `force` (Reset) bypasses it
      // deliberately — that's the one action meant to redetect from scratch.
      const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      if (!message.force && tab?.url) {
        const cached = await getCachedJob(tab.url);
        if (cached) return { type: "JOB_DATA", job: cached, sufficient: true };
      }

      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const jobResponses = responses.filter(
        (r): r is Extract<RuntimeMessage, { type: "JOB_DATA" }> => r.type === "JOB_DATA",
      );
      if (jobResponses.length === 0) return undefined;

      const sufficient = jobResponses.find((r) => r.sufficient);
      if (sufficient) {
        if (tab?.url) void setCachedJob(tab.url, sufficient.job);
        return sufficient;
      }

      // No single frame had enough signal on its own — a job's description
      // commonly lives in a different frame than its title/company header
      // (e.g. an embedded ATS widget under a career-page shell). Answer with
      // the DOM result right away plus every frame's visible text; the Side
      // Panel shows it and fills the gaps through COMPLETE_JOB in the
      // background, instead of the whole panel waiting on an AI call.
      const best = jobResponses.reduce((a, b) => (b.job.description.length > a.job.description.length ? b : a));
      const combinedText = jobResponses
        .map((r) => r.visibleText ?? "")
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 20000);
      return {
        type: "JOB_DATA",
        job: best.job,
        sufficient: false,
        visibleText: combinedText || best.visibleText || "",
        pageUrl: tab?.url,
      };
    }

    case "COMPLETE_JOB": {
      const { job, brief } = await completeJobWithAiAndBrief(message.job, message.text);
      return { type: "JOB_DATA", job, sufficient: true, brief };
    }

    case "EXTRACT_JOB_FROM_TEXT": {
      const tab = await chrome.tabs.get(message.tabId).catch(() => undefined);
      const { job, brief } = await extractJobWithAiAndBrief(message.text, tab?.url ?? "");
      return { type: "JOB_DATA", job, sufficient: true, brief };
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
      const { tabId } = message;
      const result = await runCoverLetterPipeline(message.job, message.postingLanguage, (delta) => {
        // Fire-and-forget: a dropped chunk (e.g. the panel closed mid-generation) shouldn't
        // fail the generation itself — COVER_LETTER_RESULT below still carries the full text.
        chrome.runtime
          .sendMessage({ type: "COVER_LETTER_STREAM_CHUNK", tabId, delta } satisfies RuntimeMessage)
          .catch(() => {});
      });
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
      const responses = message.targetLocator
        ? await sendToFrameOrAll(message.tabId, frameIds, message.targetLocator.frameId, message)
        : await sendToFrames(message.tabId, frameIds, message);
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

    case "GENERATE_OUTREACH_MESSAGE": {
      const context = await getApplicantContext();
      const result = await generateOutreachMessage({
        profile: context.profile,
        cvText: context.cvText,
        personalLegend: context.personalLegend,
        outreachRules: context.outreachRules,
        job: message.job,
        contact: message.contact,
        postingLanguage: message.postingLanguage,
      });
      return { type: "OUTREACH_MESSAGE_RESULT", subject: result.subject, body: result.body };
    }

    case "REVISE_OUTREACH_MESSAGE": {
      const result = await reviseOutreachMessage(
        { subject: message.subject, body: message.body },
        message.instructions,
        message.job,
      );
      return { type: "OUTREACH_MESSAGE_RESULT", subject: result.subject, body: result.body };
    }

    case "GET_FRAME_ACCESS": {
      const blockedOrigins = await findBlockedFrameOrigins(message.tabId);
      return { type: "FRAME_ACCESS", blockedOrigins };
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
      const result = await answerCustomQuestion(
        message.question,
        message.job,
        message.options,
        message.numeric,
        message.dateKind,
        message.multi,
        message.postingLanguage,
      );
      return {
        type: "CUSTOM_QUESTION_ANSWER",
        question: message.question,
        answer: result.answer,
        sufficientInfo: result.sufficientInfo,
      };
    }

    case "FILL_CUSTOM_QUESTION_ANSWERS": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      let filled = 0;
      const unfilled: string[] = [];
      for (const r of responses) {
        if (r.type === "CUSTOM_QUESTION_FILL_RESULT") {
          filled += r.filled;
          unfilled.push(...r.unfilled);
        }
      }
      return { type: "CUSTOM_QUESTION_FILL_RESULT", filled, unfilled };
    }

    case "START_ELEMENT_PICKER": {
      // Every frame gets its own overlay (the application form is often
      // inside an embedded ATS iframe, not the top document). The first
      // frame to report a real pick wins; the rest are then dismissed.
      const frameIds = await ensureContentScript(message.tabId);
      type PickResult = Extract<RuntimeMessage, { type: "ELEMENT_PICKER_RESULT" }>;
      const framePicks = frameIds.map((frameId) =>
        (chrome.tabs.sendMessage(message.tabId, message, { frameId }) as Promise<PickResult | undefined>)
          .then((result) => (result ? { result, frameId } : undefined))
          .catch(() => undefined),
      );

      const winner = await new Promise<{ result: PickResult; frameId: number } | undefined>(
        (resolve) => {
          let pending = framePicks.length;
          if (pending === 0) resolve(undefined);
          for (const pick of framePicks) {
            void pick.then((result) => {
              pending -= 1;
              // Any settled `result` means a real user interaction (a click
              // or Esc) ended the picker in that specific frame — it wins
              // immediately, even when the click landed on a block with no
              // fillable fields (`picked: []`, e.g. a mis-click on a heading
              // or wrapper div). Waiting for `picked.length > 0` here used to
              // deadlock: every other frame's own picker promise only
              // resolves on ITS OWN click/Esc/the CANCEL broadcast below, and
              // that broadcast only fires after `winner` resolves — so an
              // empty pick while any other frame's overlay was still up
              // (near-universal: ad/analytics/tracking iframes) never
              // resolved this Promise at all. `undefined` is just a frame
              // with no responding picker (no content script / injection
              // failed) — it only counts down `pending`.
              if (result) resolve(result);
              else if (pending === 0) resolve(undefined);
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

      if (!winner) {
        return { type: "ELEMENT_PICKER_RESULT", cancelled: true, picked: [], blockText: "", semanticCount: 0 };
      }
      // Stamp the frame the pick happened in, so the answers are written
      // back to that frame only (FILL_QUESTION_ANSWERS_BY_LOCATOR below).
      return {
        ...winner.result,
        picked: winner.result.picked.map((p) => ({ ...p, locator: { ...p.locator, frameId: winner.frameId } })),
      };
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
      const responses = (
        await Promise.all(
          [...groupByFrame(message.items)].map(([frameId, items]) =>
            sendToFrameOrAll(message.tabId, frameIds, frameId, { ...message, items }),
          ),
        )
      ).flat();
      let filled = 0;
      const unfilled: string[] = [];
      for (const r of responses) {
        if (r.type === "CUSTOM_QUESTION_FILL_RESULT") {
          filled += r.filled;
          unfilled.push(...r.unfilled);
        }
      }
      return { type: "CUSTOM_QUESTION_FILL_RESULT", filled, unfilled };
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

    case "DECIDE_PAGE_CONTENT": {
      const { checkboxDecisions, questionAnswers } = await decidePageContent(
        message.checkboxes,
        message.questions,
        message.job,
        message.postingLanguage,
      );
      return { type: "PAGE_CONTENT_DECISIONS", checkboxDecisions, questionAnswers };
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

    case "DETECT_JOB_BRIEF": {
      const brief = await analyzeJobBrief(message.job);
      return { type: "JOB_BRIEF_DATA", language: brief.language, keywords: brief.keywords, contact: brief.contact };
    }

    case "HIGHLIGHT_KEYWORDS": {
      const frameIds = await ensureContentScript(message.tabId);
      const responses = await sendToFrames(message.tabId, frameIds, message);
      const matched = responses.reduce((sum, r) => (r.type === "KEYWORD_HIGHLIGHT_RESULT" ? sum + r.matched : sum), 0);
      return { type: "KEYWORD_HIGHLIGHT_RESULT", matched };
    }

    case "CLEAR_KEYWORD_HIGHLIGHTS": {
      const frameIds = await ensureContentScript(message.tabId);
      await sendToFrames(message.tabId, frameIds, message);
      return undefined;
    }

    case "GENERATE_FAQ_ANSWERS": {
      const existing = await getFaqAnswers();
      const entries = await fillMissingFaqAnswers(message.questions, existing);
      try {
        await saveFaqAnswers(entries);
      } catch {
        // `saveFaqAnswers` writes the local cache before the Drive call that
        // can throw here (Drive not connected yet, expired token) — that
        // write already landed, so still hand back the freshly generated
        // (paid) answers instead of losing them to an unrelated Drive error.
      }
      return { type: "FAQ_ANSWERS_RESULT", entries };
    }

    case "SEARCH_JOBS": {
      const { provider } = message.query;
      const startedAt = performance.now();
      const stages: JobSearchStageTiming[] = [];
      const timing = () => ({ totalMs: performance.now() - startedAt, stages });
      const { searchId } = message;
      // Results already in, ahead of the final reply. Fire-and-forget, like the
      // cover-letter stream: the final reply still carries everything.
      const onResults = searchId
        ? (partial: JobSearchResult[]) => {
            chrome.runtime
              .sendMessage({ type: "JOB_SEARCH_PROGRESS", searchId, results: partial } satisfies RuntimeMessage)
              .catch(() => {});
          }
        : undefined;
      if (provider === "adzuna") {
        // Adzuna's "what" is a keyword search field, not an LLM prompt — the
        // candidate digest below is for the two AI-backed providers only.
        const [creds, profile] = await Promise.all([getJobSearchCredentials(), getProfile()]);
        if (!creds.adzunaAppId || !creds.adzunaAppKey) {
          throw new Error("Add your Adzuna app_id and app_key in Settings first.");
        }
        // "Keywords decide a lot" for a literal keyword search — never send
        // Adzuna a single empty/guessed "what" just because the user left it
        // blank; derive a whole set of title-synonym + per-spoken-language
        // tags from their own CV instead (`suggestSearchTags`), and fan the
        // search out over all of them (`searchAdzunaJobs`). Returned as
        // `resolvedQuery` so the Job Search screen locks `tags` (and
        // `what`/`where`) into its own state — otherwise a "load more" page 2
        // would re-derive independently and could land on a *different* tag
        // set than page 1, an inconsistent pagination sequence.
        let query = message.query;
        if (!query.tags?.length) {
          if (query.what.trim()) {
            // A user-typed keyword is a deliberate, specific override — respect
            // it as-is rather than second-guessing it with AI-derived tags.
            query = { ...query, tags: [query.what.trim()] };
          } else {
            const startedSuggest = performance.now();
            const suggestion = await getSearchSuggestion(true);
            stages.push({ label: suggestion.cached ? "Suggest tags (cached)" : "Suggest tags", ms: performance.now() - startedSuggest });
            query = {
              ...query,
              what: suggestion.what,
              where: query.where.trim() || suggestion.where,
              tags: suggestion.tags?.length ? suggestion.tags : [suggestion.what],
            };
          }
        }
        const { results, warnings } = await timeStage(stages, "Adzuna search", () =>
          searchAdzunaJobs(
            query,
            { appId: creds.adzunaAppId, appKey: creds.adzunaAppKey },
            adzunaCountryCode(profile.country),
            message.page ?? 1,
            onResults,
          ),
        );
        return { type: "JOB_SEARCH_RESULTS", results, resolvedQuery: query, warnings, ...timing() };
      }
      // Per spec_8 item 8: job-search grounding uses the applicant's own
      // Personal Legend directly rather than a separately AI-generated
      // digest — one less thing to keep in sync, and the applicant already
      // controls exactly what it says.
      const [legend, creds] = await Promise.all([getPersonalLegend(), getJobSearchCredentials()]);
      const background = legend?.content ?? "";
      if (provider === "tavily") {
        if (!creds.tavilyApiKey) throw new Error("Add your Tavily API key in Settings first.");
        const results = await searchTavilyJobs(message.query, creds.tavilyApiKey, background, message.excludeResults, stages);
        return { type: "JOB_SEARCH_RESULTS", results, resolvedQuery: message.query, ...timing() };
      }
      const results = await searchOpenAiJobs(message.query, background, message.excludeResults, stages, onResults);
      return { type: "JOB_SEARCH_RESULTS", results, resolvedQuery: message.query, ...timing() };
    }

    case "SUGGEST_SEARCH_QUERY": {
      // Adzuna's "what" is a literal keyword match, so a single LLM-derived
      // title (e.g. "Full-Stack Developer / Backend Engineer (Go, Python,
      // React)") routinely matches zero postings. For Adzuna, also derive the
      // atomic tag set here (`suggestSearchTags`) so the Job Search screen
      // can lock it straight into `tags` — otherwise a non-empty "what" from
      // this same suggestion would later be treated as a deliberate manual
      // override in `SEARCH_JOBS` and searched as one ungarbled phrase
      // instead of being fanned out.
      // Cached per CV/legend/profile (`getSearchSuggestion`), so a repeat costs no AI call.
      const { what, where, tags } = await getSearchSuggestion(message.provider === "adzuna");
      return { type: "SEARCH_QUERY_SUGGESTION", what, where, ...(message.provider === "adzuna" ? { tags } : {}) };
    }

    case "SUGGEST_CV_VALUES": {
      const values = await suggestCvValues(message.job, message.template);
      return { type: "CV_VALUES", values };
    }

    default:
      return undefined;
  }
}
