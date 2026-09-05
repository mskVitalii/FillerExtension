import { describe, expect, it } from "vitest";
import { HOUSE_STYLE_RULES, stripEmDashes } from "@/features/openai/house-style";
import { detectSlop } from "@/features/cover-letter/slop-detector";

describe("stripEmDashes", () => {
  it("replaces a spaced em dash with a comma", () => {
    expect(stripEmDashes("I led the migration — we cut costs by half.")).toBe(
      "I led the migration, we cut costs by half.",
    );
  });

  it("replaces an unspaced em dash", () => {
    expect(stripEmDashes("fast—reliable")).toBe("fast, reliable");
  });

  it("handles a parenthetical em-dash pair", () => {
    expect(stripEmDashes("the result — a 3x speedup — held under load")).toBe(
      "the result, a 3x speedup, held under load",
    );
  });

  it("drops a comma left dangling before end punctuation", () => {
    expect(stripEmDashes("I shipped it — finally.")).toBe("I shipped it, finally.");
    expect(stripEmDashes("we scaled it —")).toBe("we scaled it");
  });

  it("converts a ' -- ' substitute", () => {
    expect(stripEmDashes("small team -- big impact")).toBe("small team, big impact");
  });

  it("converts a spaced en dash used as punctuation", () => {
    expect(stripEmDashes("I joined early – before the product existed")).toBe(
      "I joined early, before the product existed",
    );
  });

  it("leaves hyphenated words and numeric ranges alone", () => {
    expect(stripEmDashes("a full-stack engineer, 2019-2022, on-site")).toBe(
      "a full-stack engineer, 2019-2022, on-site",
    );
    expect(stripEmDashes("worked there 2019–2022")).toBe("worked there 2019–2022");
  });

  it("is a no-op on clean prose", () => {
    const clean = "I build tools for engineers. I shipped three of them last year.";
    expect(stripEmDashes(clean)).toBe(clean);
  });
});

describe("HOUSE_STYLE_RULES", () => {
  it("is embedded, not a skill call, and names the em-dash ban plus key tropes", () => {
    expect(HOUSE_STYLE_RULES).toMatch(/em dash/i);
    expect(HOUSE_STYLE_RULES).toMatch(/\bdelve\b/);
    expect(HOUSE_STYLE_RULES).toMatch(/not X, it's Y/i);
    expect(HOUSE_STYLE_RULES).toMatch(/In conclusion/);
  });
});

describe("detectSlop — em dash", () => {
  it("flags a single em dash", () => {
    const findings = detectSlop("I led it — and it worked.");
    expect(findings.some((f) => f.pattern === "em-dash")).toBe(true);
  });

  it("does not flag prose with none", () => {
    const findings = detectSlop("I led it, and it worked.");
    expect(findings.some((f) => f.pattern === "em-dash")).toBe(false);
  });
});
