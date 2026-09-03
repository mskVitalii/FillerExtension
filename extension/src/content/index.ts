import type { RuntimeMessage } from "@/types/messages";
import { extractJob, isExtractionSufficient } from "@/features/job-extraction/extractor";
import { autofillDocument } from "@/features/autofill/engine";
import { fillElement } from "@/features/autofill/native-setter";
import { fillDialCodeField, formatSalaryForField, resolvePhoneFill } from "@/features/autofill/field-format";
import { findConfirmPasswordFields } from "@/features/autofill/password-fields";
import { countryCandidates } from "@/lib/country-codes";
import { getInsertTarget, initFocusTracker } from "@/features/autofill/focus-tracker";
import { detectCustomQuestions, fillCustomQuestionAnswers } from "@/features/autofill/custom-questions";
import { fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { cancelActivePicker, startElementPicker } from "@/features/autofill/element-picker";
import { applyCheckboxDecisions, detectCheckboxes } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { initFileDropCatcher } from "@/features/file-upload/drop-catcher";
import { announceGeneratedPassword } from "@/features/autofill/password-toast";
import { showPageToast } from "@/features/autofill/page-toast";
import { INSERT_FIELD_LABELS } from "@/features/autofill/insert-field-labels";
import { base64ToFile } from "@/lib/base64";

/**
 * Right-click "Insert" places one value into whichever field the user
 * clicked, so — like bulk Autofill — the phone/salary/country value is
 * rendered to match that field: `+49…` vs `0170…` vs a bare national number
 * beside a dial-code box, a rounded integer for a number-only salary field,
 * the country spelling the page's `<select>` uses.
 */
function insertFieldValue(target: HTMLElement, field: string, value: string): boolean {
  if (field === "phone") {
    const fill = resolvePhoneFill(target, value);
    if (!fill) return fillElement(target, value);
    if (fill.dialCodeField) fillDialCodeField(fill.dialCodeField, fill.phone);
    return fillElement(target, fill.value);
  }
  if (field === "expectedSalary") {
    return fillElement(target, formatSalaryForField(target, value));
  }
  if (field === "country" && target instanceof HTMLSelectElement) {
    for (const candidate of countryCandidates(value)) {
      if (fillElement(target, candidate)) return true;
    }
    return false;
  }
  return fillElement(target, value);
}

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
        if (result.generatedPassword) void announceGeneratedPassword(result.generatedPassword);
        const response: RuntimeMessage = { type: "AUTOFILL_RESULT", ...result };
        sendResponse(response);
        return false;
      }

      case "INSERT_VALUE": {
        // Every exit from this handler used to be silent — success and
        // every failure mode looked identical to the user ("nothing
        // happened"), which is exactly why the feature read as broken even
        // when it was working. Each branch now says what happened and why.
        const target = getInsertTarget();
        if (!target) {
          showPageToast(
            "Insert: couldn't tell which field you meant — click into it once, then right-click it again.",
            "error",
          );
          sendResponse();
          return false;
        }

        if (!message.value) {
          showPageToast(
            `Insert: "${INSERT_FIELD_LABELS[message.field]}" is empty — nothing to place there yet.`,
            "error",
          );
          sendResponse();
          return false;
        }

        const filled = insertFieldValue(target, message.field, message.value);

        if (message.field === "generatePassword") {
          if (filled && target instanceof HTMLInputElement && target.type === "password") {
            for (const confirmField of findConfirmPasswordFields(target)) {
              fillElement(confirmField, message.value);
            }
          }
          // Still hand back/copy the password even if the field itself
          // couldn't be filled (unsupported element) — it's the one value
          // with no other record, so losing it silently would be worse.
          void announceGeneratedPassword(message.value);
        } else if (!filled) {
          // A successful insert is its own feedback — the value now sits
          // right there in the field. A toast only earns its place when
          // nothing visible happened and the user needs to know why.
          showPageToast("Insert: this field type isn't supported here.", "error");
        }
        sendResponse();
        return false;
      }

      case "DETECT_CUSTOM_QUESTIONS": {
        const questions = detectCustomQuestions();
        const response: RuntimeMessage = { type: "CUSTOM_QUESTIONS_DATA", questions };
        sendResponse(response);
        return false;
      }

      case "FILL_CUSTOM_QUESTION_ANSWERS": {
        const filled = fillCustomQuestionAnswers(message.answers);
        const response: RuntimeMessage = { type: "CUSTOM_QUESTION_FILL_RESULT", filled };
        sendResponse(response);
        return false;
      }

      case "START_ELEMENT_PICKER": {
        // Held open until the user clicks a block or cancels (Esc, or
        // background telling this frame another frame won the pick).
        void startElementPicker().then((outcome) => {
          const response: RuntimeMessage = outcome.cancelled
            ? { type: "ELEMENT_PICKER_RESULT", cancelled: true, picked: [], blockText: "", semanticCount: 0 }
            : {
                type: "ELEMENT_PICKER_RESULT",
                cancelled: false,
                picked: outcome.picked,
                blockText: outcome.blockText,
                semanticCount: outcome.semanticCount,
              };
          sendResponse(response);
        });
        return true;
      }

      case "CANCEL_ELEMENT_PICKER": {
        cancelActivePicker();
        sendResponse();
        return false;
      }

      case "FILL_QUESTION_ANSWERS_BY_LOCATOR": {
        const filled = fillAnswersByLocator(message.items);
        const response: RuntimeMessage = { type: "CUSTOM_QUESTION_FILL_RESULT", filled };
        sendResponse(response);
        return false;
      }

      case "DETECT_CHECKBOXES": {
        const response: RuntimeMessage = { type: "CHECKBOXES_DATA", checkboxes: detectCheckboxes() };
        sendResponse(response);
        return false;
      }

      case "APPLY_CHECKBOX_DECISIONS": {
        const changed = applyCheckboxDecisions(message.decisions);
        const response: RuntimeMessage = { type: "CHECKBOX_APPLY_RESULT", changed };
        sendResponse(response);
        return false;
      }

      case "UPLOAD_FILE": {
        const file = base64ToFile(message.base64Data, message.fileName, message.mimeType);
        const result = injectFileIntoPage(file, message.targetLocator);
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
  initFileDropCatcher();
  registerMessageListener();
}
