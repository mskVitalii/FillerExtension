import { describe, expect, it } from "vitest";
import { AVAILABLE_MODELS, MODEL_LUNA, MODEL_TERRA, isSupportedModel, resolveModel } from "@/features/openai/client";

describe("OpenAI model list", () => {
  it("accepts the curated models and newer GPT-6+ text models", () => {
    for (const id of AVAILABLE_MODELS) expect(isSupportedModel(id)).toBe(true);
    expect(isSupportedModel("gpt-6-sol")).toBe(true);
    expect(isSupportedModel("gpt-6.2-luna")).toBe(true);
  });

  it("rejects retired, specialized, dated and non-text ids", () => {
    for (const id of [
      "gpt-5.6-terra",
      "gpt-5.6-astra",
      "gpt-4o",
      "gpt-5.6-cyber",
      "gpt-realtime-2.1",
      "gpt-image-2.5-flare",
      "gpt-live-1",
      "gpt-6-luna-2026-05-18",
      "text-embedding-3-small",
    ]) {
      expect(isSupportedModel(id)).toBe(false);
    }
  });

  it("falls back to the tier default for an empty or stale preference", () => {
    expect(resolveModel("", MODEL_TERRA)).toBe(MODEL_TERRA);
    expect(resolveModel("gpt-5.6-luna", MODEL_LUNA)).toBe(MODEL_LUNA);
    expect(resolveModel("gpt-6-astra", MODEL_TERRA)).toBe("gpt-6-astra");
  });
});
