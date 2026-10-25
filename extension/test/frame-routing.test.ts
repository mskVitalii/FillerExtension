import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeMessage } from "@/types/messages";
import type { ElementLocator } from "@/features/autofill/element-locator";
import { routeMessage } from "@/background/router";

/**
 * Forms inside iframes: the content script runs once per frame, so the
 * background has to send every request to every frame and write each
 * answer back to the frame its field came from. Chrome itself isn't
 * available here, so `chrome.scripting`/`chrome.tabs`/`chrome.permissions`
 * are stubbed with two frames: 0 (the career page) and 7 (an embedded ATS
 * form).
 */

type Sent = { frameId: number; message: RuntimeMessage };
let sent: Sent[] = [];
let frameReply: (frameId: number, message: RuntimeMessage) => Promise<unknown>;
let executeScriptResults: unknown[] = [{ frameId: 0 }, { frameId: 7 }];
let granted = new Set<string>();

const locator = (tag: string, frameId?: number): ElementLocator => ({ tag, selector: "", textHint: "", frameId });

beforeEach(() => {
  sent = [];
  granted = new Set();
  executeScriptResults = [{ frameId: 0 }, { frameId: 7 }];
  frameReply = async () => ({ type: "CUSTOM_QUESTION_FILL_RESULT", filled: 1, unfilled: [] });
  (globalThis as unknown as { chrome: unknown }).chrome = {
    scripting: {
      executeScript: vi.fn(async (details: { func?: () => unknown }) =>
        details.func ? executeScriptResults : [{ frameId: 0 }, { frameId: 7 }],
      ),
    },
    tabs: {
      sendMessage: vi.fn((_tabId: number, message: RuntimeMessage, options: { frameId: number }) => {
        sent.push({ frameId: options.frameId, message });
        return frameReply(options.frameId, message);
      }),
      get: vi.fn(async () => ({ url: "https://careers.acme.com/jobs/1" })),
    },
    permissions: {
      contains: vi.fn(async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o))),
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { chrome?: unknown }).chrome;
});

describe("frame routing", () => {
  it("stamps a pick with the frame it happened in", async () => {
    frameReply = (frameId, message) => {
      if (message.type === "CANCEL_ELEMENT_PICKER") return Promise.resolve(undefined);
      // Frame 0's overlay stays up (no click there); frame 7 reports the pick.
      if (frameId === 0) return new Promise(() => {});
      return Promise.resolve({
        type: "ELEMENT_PICKER_RESULT",
        cancelled: false,
        picked: [{ locator: locator("f1"), question: "Why us?", confident: true, descriptor: {} }],
        blockText: "Why us?",
        semanticCount: 0,
      });
    };
    const result = (await routeMessage({ type: "START_ELEMENT_PICKER", tabId: 1 })) as Extract<
      RuntimeMessage,
      { type: "ELEMENT_PICKER_RESULT" }
    >;
    expect(result.picked[0].locator.frameId).toBe(7);
    // Every frame's overlay is dismissed afterwards.
    expect(sent.filter((s) => s.message.type === "CANCEL_ELEMENT_PICKER").map((s) => s.frameId)).toEqual([0, 7]);
  });

  it("writes each answer back only to its own frame, broadcasting only frame-less items", async () => {
    const result = await routeMessage({
      type: "FILL_QUESTION_ANSWERS_BY_LOCATOR",
      tabId: 1,
      items: [
        { locator: locator("in-ats", 7), answer: "A" },
        { locator: locator("legacy"), answer: "B" },
      ],
    });
    const fills = sent.filter((s) => s.message.type === "FILL_QUESTION_ANSWERS_BY_LOCATOR");
    const tagsByFrame = fills.map((s) => [
      s.frameId,
      (s.message as Extract<RuntimeMessage, { type: "FILL_QUESTION_ANSWERS_BY_LOCATOR" }>).items.map(
        (i) => i.locator.tag,
      ),
    ]);
    expect(tagsByFrame).toContainEqual([7, ["in-ats"]]);
    expect(tagsByFrame).not.toContainEqual([0, ["in-ats"]]);
    expect(tagsByFrame).toContainEqual([0, ["legacy"]]);
    expect(tagsByFrame).toContainEqual([7, ["legacy"]]);
    expect(result).toEqual({ type: "CUSTOM_QUESTION_FILL_RESULT", filled: 3, unfilled: [] });
  });

  it("falls back to every frame when the stamped frame is gone", async () => {
    await routeMessage({
      type: "FILL_QUESTION_ANSWERS_BY_LOCATOR",
      tabId: 1,
      items: [{ locator: locator("old", 42), answer: "A" }],
    });
    expect(sent.map((s) => s.frameId).sort()).toEqual([0, 7]);
  });

  it("sends a file dropped on a field only to that field's frame", async () => {
    frameReply = async () => ({ type: "UPLOAD_FILE_RESULT", nativeInputs: 1, dropZones: 0 });
    await routeMessage({
      type: "UPLOAD_FILE",
      tabId: 1,
      kind: "cv",
      fileName: "cv.pdf",
      mimeType: "application/pdf",
      base64Data: "",
      targetLocator: locator("file", 7),
    });
    expect(sent.map((s) => s.frameId)).toEqual([7]);
  });
});

describe("cross-origin frames without access", () => {
  /** Runs the real per-frame probe against a jsdom page with these iframes. */
  function pageWithFrames(frames: { src: string; width: number; height: number }[]) {
    document.body.innerHTML = frames.map((f) => `<iframe src="${f.src}"></iframe>`).join("");
    document.querySelectorAll("iframe").forEach((el, i) => {
      const { width, height } = frames[i];
      el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0 }) as DOMRect;
    });
    (chrome.scripting.executeScript as ReturnType<typeof vi.fn>).mockImplementation(
      async (details: { func?: () => unknown }) => (details.func ? [{ frameId: 0, result: details.func() }] : []),
    );
  }

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports a visible embedded form's origin, skipping pixels and same-origin frames", async () => {
    pageWithFrames([
      { src: "https://boards.greenhouse.io/acme/jobs/1", width: 800, height: 1200 },
      { src: "https://tracker.example/pixel", width: 1, height: 1 },
      { src: `${location.origin}/inner`, width: 800, height: 400 },
    ]);
    const result = await routeMessage({ type: "GET_FRAME_ACCESS", tabId: 1 });
    expect(result).toEqual({ type: "FRAME_ACCESS", blockedOrigins: ["https://boards.greenhouse.io"] });
  });

  it("stops reporting an origin once the user granted it", async () => {
    granted.add("https://boards.greenhouse.io/*");
    pageWithFrames([{ src: "https://boards.greenhouse.io/acme/jobs/1", width: 800, height: 1200 }]);
    const result = await routeMessage({ type: "GET_FRAME_ACCESS", tabId: 1 });
    expect(result).toEqual({ type: "FRAME_ACCESS", blockedOrigins: [] });
  });
});
