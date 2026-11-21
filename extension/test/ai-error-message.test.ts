import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/features/openai/fallback", () => ({ getFallbackSettings: async () => ({ policy: "unavailable", apiKey: "", models: {} }) }));
const { AiErrorMessage } = await import("@/components/AiErrorMessage");

// Exactly what the Side Panel showed before (the raw 429 body, pretty-printed JSON flattened into one line).
const RAW =
  'OpenAI request failed (429): { "error": { "code": "credit_balance_exhausted", "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.", "param": null, "type": "insufficient_quota" } }';

describe("AiErrorMessage", () => {
  it("turns the out-of-credits error into instructions with OpenAI's message as a detail", () => {
    const html = renderToStaticMarkup(createElement(AiErrorMessage, { text: RAW }));
    expect(html).toContain("run out of credits");
    expect(html).toContain("Open OpenAI billing");
    expect(html).toContain("OpenAI: You have no credits remaining.");
    expect(html).not.toContain("OpenAI request failed (429)");
    expect(html).not.toContain("{ &quot;error&quot;");
  });

  it("leaves any other error as the plain line", () => {
    expect(renderToStaticMarkup(createElement(AiErrorMessage, { text: "Something else failed" }))).toBe('<p class="text-xs text-destructive">Something else failed</p>');
  });
});
