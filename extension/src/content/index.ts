import type { RuntimeMessage } from "@/types/messages";
import { extractJob, isExtractionSufficient } from "@/features/job-extraction/extractor";
import { autofillDocument } from "@/features/autofill/engine";
import { fillElement } from "@/features/autofill/native-setter";
import { getInsertTarget, initFocusTracker } from "@/features/autofill/focus-tracker";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { base64ToFile } from "@/lib/base64";

declare global {
  interface Window {
    __fillerContentScriptLoaded?: boolean;
  }
}

/**
 * Single message entry point for this content script (spec section 21-22).
 * Background routes Side Panel requests here; this script owns all DOM
 * access — extraction, autofill, context-menu inserts, file injection.
 */
function registerMessageListener(): void {
  chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
    switch (message.type) {
      case "GET_JOB": {
        const job = extractJob(document, location.href);
        const sufficient = isExtractionSufficient(job);
        const response: RuntimeMessage = sufficient
          ? { type: "JOB_DATA", job, sufficient: true }
          : {
              type: "JOB_DATA",
              job,
              sufficient: false,
              visibleText: (document.body.innerText || "").slice(0, 20000),
            };
        sendResponse(response);
        return false;
      }

      case "AUTOFILL": {
        const result = autofillDocument(message.profile);
        const response: RuntimeMessage = { type: "AUTOFILL_RESULT", ...result };
        sendResponse(response);
        return false;
      }

      case "INSERT_VALUE": {
        const target = getInsertTarget();
        if (target) fillElement(target, message.value);
        sendResponse();
        return false;
      }

      case "DETECT_CUSTOM_QUESTIONS": {
        const questions = detectCustomQuestions();
        const response: RuntimeMessage = { type: "CUSTOM_QUESTIONS_DATA", questions };
        sendResponse(response);
        return false;
      }

      case "UPLOAD_FILE": {
        const file = base64ToFile(message.base64Data, message.fileName, message.mimeType);
        const result = injectFileIntoPage(file);
        const response: RuntimeMessage = { type: "UPLOAD_FILE_RESULT", ...result };
        sendResponse(response);
        return false;
      }

      default:
        return false;
    }
  });
}

/**
 * Injected on demand via chrome.scripting.executeScript (see
 * background/inject-content-script.ts) instead of a broad-matching
 * manifest content_scripts entry, so the same tab can be re-injected
 * more than once in a session — guard against registering duplicate
 * listeners on repeat injection.
 */
if (!window.__fillerContentScriptLoaded) {
  window.__fillerContentScriptLoaded = true;
  initFocusTracker();
  registerMessageListener();
}
