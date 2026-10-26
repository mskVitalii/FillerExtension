import { describe, expect, it } from "vitest";
import {
  adzunaExcludeWords,
  negativeDomains,
  negativeInstruction,
  offlineNegativeTerms,
  parseNegativeTerms,
  splitByNegative,
} from "@/features/job-search/negative";
import type { JobSearchResult } from "@/types/job-search";

function job(title: string, extra: Partial<JobSearchResult> = {}): JobSearchResult {
  return { title, company: "Acme", location: "Berlin", url: `https://x/${encodeURIComponent(title)}`, salary: "", snippet: "", source: "openai", ...extra };
}

describe("parseNegativeTerms", () => {
  it("splits on commas/lines and strips the lead-in negation", () => {
    expect(parseNegativeTerms("no crypto, no gambling, no on-site only, no agencies")).toEqual([
      "crypto",
      "gambling",
      "on-site only",
      "agencies",
    ]);
    expect(parseNegativeTerms("без крипты;\nникаких казино\nkeine Agenturen")).toEqual(["крипты", "казино", "Agenturen"]);
  });

  it("dedupes case-insensitively and drops empty parts", () => {
    expect(parseNegativeTerms("Crypto, , crypto,, no ")).toEqual(["Crypto"]);
  });

  it("keeps a word that merely starts like a negation", () => {
    expect(parseNegativeTerms("no-code, Notion")).toEqual(["no-code", "Notion"]);
  });
});

describe("offlineNegativeTerms", () => {
  it("leaves long clauses to the AI", () => {
    expect(offlineNegativeTerms("crypto, nothing that requires a security clearance")).toEqual(["crypto"]);
  });
});

describe("splitByNegative", () => {
  const results = [
    job("Backend Engineer", { company: "CryptoX Exchange" }),
    job("Backend Engineer, Crypto Payments"),
    job("JavaScript Developer"),
    job("Java Developer"),
    job("Recruiter", { company: "Talent Agency GmbH" }),
    job("Разработчик в казино"),
    job("Frontend Engineer", { snippet: "Online gambling platform, 5 days on-site." }),
    job("Platform Engineer", { location: "Crypto Valley, Zug" }),
  ];

  it("drops whole-word matches in title, company and snippet", () => {
    const { kept, hidden } = splitByNegative(results, "no crypto, no Java, no agencies, без казино, gambling");
    expect(kept.map((r) => r.title)).toEqual(["Backend Engineer", "JavaScript Developer", "Platform Engineer"]);
    expect(hidden.map(({ result, term }) => [result.title, term])).toEqual([
      ["Backend Engineer, Crypto Payments", "crypto"],
      ["Java Developer", "Java"],
      ["Recruiter", "agencies"],
      ["Разработчик в казино", "казино"],
      ["Frontend Engineer", "gambling"],
    ]);
  });

  it("is a no-op without terms", () => {
    expect(splitByNegative(results, "  ").kept).toHaveLength(results.length);
  });

  it("matches singular/plural both ways", () => {
    expect(splitByNegative([job("Staffing agency")], "agencies").hidden).toHaveLength(1);
    expect(splitByNegative([job("We are not one of those agencies")], "agency").hidden).toHaveLength(1);
    expect(splitByNegative([job("Senior recruiters wanted")], "recruiter").hidden).toHaveLength(1);
  });

  it("keeps acronyms case-sensitive", () => {
    expect(splitByNegative([job("Build ai tooling")], "AI").hidden).toHaveLength(0);
    expect(splitByNegative([job("AI engineer")], "AI").hidden).toHaveLength(1);
  });
});

describe("adzunaExcludeWords", () => {
  it("sends only single plain words, with their plural/singular", () => {
    expect(adzunaExcludeWords("no crypto, no on-site only, no agencies, gambling jobs, only")).toBe(
      "crypto cryptos agencies agency",
    );
    expect(adzunaExcludeWords("")).toBe("");
    expect(adzunaExcludeWords(undefined)).toBe("");
  });
});

describe("negativeDomains", () => {
  it("picks out terms that are domains", () => {
    expect(negativeDomains("no linkedin.com, https://www.indeed.com/jobs, crypto")).toEqual(["linkedin.com", "indeed.com"]);
  });
});

describe("negativeInstruction", () => {
  it("quotes the whole text, or is empty", () => {
    expect(negativeInstruction("no crypto,\nno agencies")).toContain('"no crypto, no agencies"');
    expect(negativeInstruction("   ")).toBe("");
    expect(negativeInstruction(undefined)).toBe("");
  });
});
