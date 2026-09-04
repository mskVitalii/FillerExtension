import { describe, expect, it } from "vitest";
import { isNonAnswer } from "@/features/openai/answer-question";

/**
 * Backstop for a "please provide the actual question" refusal slipping
 * through as if it were a real answer — the two exact phrasings reported
 * live, plus a check that a legitimate "I don't have direct experience
 * with X, but…" honest answer (which the system prompt explicitly asks
 * for when real profile data is missing) is never mistaken for one.
 */
describe("isNonAnswer", () => {
  it("recognizes the reported refusal phrasings", () => {
    expect(isNonAnswer("Please provide the specific application question so I can prepare an accurate answer.")).toBe(
      true,
    );
    expect(isNonAnswer("Please provide the specific question or prompt you would like me to answer.")).toBe(true);
  });

  it("recognizes a couple of other common refusal shapes", () => {
    expect(isNonAnswer("Could you please clarify the question?")).toBe(true);
    expect(isNonAnswer("No specific question was provided.")).toBe(true);
  });

  it("never flags an empty answer as anything but a non-answer", () => {
    expect(isNonAnswer("")).toBe(true);
    expect(isNonAnswer("   ")).toBe(true);
  });

  it("does not flag a real, substantive answer", () => {
    expect(
      isNonAnswer(
        "At OZON Tech, I owned a Go microservice for warehouse search that indexed ~200 million items in Elasticsearch.",
      ),
    ).toBe(false);
  });

  it("does not flag a legitimate honest 'I don't have X' answer (explicitly asked for by the system prompt when profile data is missing)", () => {
    expect(
      isNonAnswer(
        "I don't have direct experience with that specific system, but I've worked on similar distributed caching layers.",
      ),
    ).toBe(false);
    expect(isNonAnswer("No, I have not previously been employed by AVL Group.")).toBe(false);
  });
});
