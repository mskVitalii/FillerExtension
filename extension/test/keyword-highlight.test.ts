import { afterEach, describe, expect, it, vi } from "vitest";
import { clearKeywordHighlights, highlightKeywords } from "@/features/highlight/keyword-highlight";
import type { JobKeyword } from "@/types/job";

const kw = (text: string, matchesProfile: boolean): JobKeyword => ({ text, matchesProfile });

/**
 * Unlike the CSS Custom Highlight API this feature used before, jsdom does
 * implement everything the current DOM-wrapping approach relies on
 * (TreeWalker, MutationObserver, Node#normalize), so this drives the real
 * match/wrap/reapply logic rather than just a feature-detection fallback.
 */
describe("keyword highlighting", () => {
  afterEach(() => {
    clearKeywordHighlights();
    document.body.innerHTML = "";
  });

  it("wraps every match and returns the match count", () => {
    document.body.innerHTML = "<p>Looking for a Senior TypeScript engineer with TypeScript experience.</p>";
    const matched = highlightKeywords([kw("TypeScript", true), kw("engineer", true)]);
    expect(matched).toBe(3);
    const wrappers = document.querySelectorAll(".filler-keyword-highlight");
    expect(wrappers).toHaveLength(3);
    expect(document.body.textContent).toBe(
      "Looking for a Senior TypeScript engineer with TypeScript experience.",
    );
  });

  it("prefers the longest keyword when keywords overlap", () => {
    document.body.innerHTML = "<p>Senior Product Manager role.</p>";
    highlightKeywords([kw("Product Manager", true), kw("Senior Product Manager", true)]);
    const wrappers = document.querySelectorAll(".filler-keyword-highlight");
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0]?.textContent).toBe("Senior Product Manager");
  });

  it("colors a profile match apart from a profile gap", () => {
    document.body.innerHTML = "<p>Needs TypeScript and Kubernetes.</p>";
    highlightKeywords([kw("TypeScript", true), kw("Kubernetes", false)]);

    const tsWrapper = [...document.querySelectorAll(".filler-keyword-highlight")].find(
      (el) => el.textContent === "TypeScript",
    );
    const k8sWrapper = [...document.querySelectorAll(".filler-keyword-highlight")].find(
      (el) => el.textContent === "Kubernetes",
    );
    expect(tsWrapper?.classList.contains("filler-keyword-highlight--match")).toBe(true);
    expect(tsWrapper?.classList.contains("filler-keyword-highlight--gap")).toBe(false);
    expect(k8sWrapper?.classList.contains("filler-keyword-highlight--gap")).toBe(true);
    expect(k8sWrapper?.classList.contains("filler-keyword-highlight--match")).toBe(false);
  });

  it("ignores keywords shorter than 2 characters and returns 0 for no matches", () => {
    document.body.innerHTML = "<p>Nothing relevant here.</p>";
    expect(highlightKeywords([kw("a", true), kw("Rust", true)])).toBe(0);
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(0);
  });

  it("does not throw and no-ops when called with no matching body content", () => {
    document.body.innerHTML = "";
    expect(() => highlightKeywords([kw("TypeScript", true)])).not.toThrow();
  });

  it("clearKeywordHighlights unwraps spans and restores plain text", () => {
    document.body.innerHTML = "<p>A TypeScript role.</p>";
    highlightKeywords([kw("TypeScript", true)]);
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(1);

    clearKeywordHighlights();
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(0);
    expect(document.getElementById("filler-keyword-highlight-style")).toBeNull();
    expect(document.body.innerHTML).toBe("<p>A TypeScript role.</p>");
  });

  it("clearKeywordHighlights doesn't throw when nothing was highlighted", () => {
    expect(() => clearKeywordHighlights()).not.toThrow();
  });

  it("re-applies highlights after the page reverts the wrapped text (SPA re-render)", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<p id="target">A TypeScript role.</p>';
    highlightKeywords([kw("TypeScript", true)]);
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(1);

    // Simulate the host page re-rendering that subtree back to plain text.
    document.getElementById("target")!.textContent = "A TypeScript role.";
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(0);

    await vi.runOnlyPendingTimersAsync();
    expect(document.querySelectorAll(".filler-keyword-highlight")).toHaveLength(1);
    vi.useRealTimers();
  });
});
