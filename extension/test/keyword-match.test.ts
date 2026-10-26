import { describe, expect, it } from "vitest";
import { containsKeyword, countKeyword, createKeywordMatcher } from "@/features/keywords/match";

const found = (text: string, keywords: string[]) =>
  createKeywordMatcher(keywords)(text).map((m) => m.text);

describe("keyword matching: word boundaries", () => {
  it("doesn't find a keyword inside a longer word", () => {
    expect(containsKeyword("We work at Google.", "Go")).toBe(false);
    expect(containsKeyword("Strong React skills", "R")).toBe(false);
    expect(containsKeyword("Modern JavaScript", "Java")).toBe(false);
    expect(containsKeyword("TypeScripted", "TypeScript")).toBe(false);
    expect(containsKeyword("snake_case_Go", "Go")).toBe(false);
  });

  it("finds a whole word next to punctuation", () => {
    expect(containsKeyword("Backend in Go.", "Go")).toBe(true);
    expect(containsKeyword("(Go, Rust)", "Go")).toBe(true);
    expect(containsKeyword("Java/Kotlin", "Java")).toBe(true);
    expect(containsKeyword("React-based UI", "React")).toBe(true);
    expect(containsKeyword("Statistics in R and Python", "R")).toBe(true);
  });

  it("matches acronyms and two-letter keywords with exact case", () => {
    expect(containsKeyword("Let's go to the office", "Go")).toBe(false);
    expect(containsKeyword("make it work", "IT")).toBe(false);
    expect(containsKeyword("the rest of the team", "REST")).toBe(false);
    expect(containsKeyword("REST APIs", "REST")).toBe(true);
    expect(containsKeyword("Typescript and kubernetes", "TypeScript")).toBe(true);
    expect(containsKeyword("Typescript and kubernetes", "Kubernetes")).toBe(true);
  });

  it("lets a space in a keyword match any whitespace run", () => {
    expect(containsKeyword("machine  learning", "machine learning")).toBe(true);
    expect(containsKeyword("machine\nlearning", "machine learning")).toBe(true);
  });
});

describe("keyword matching: special characters", () => {
  it("handles C++, C# and their single-letter prefixes", () => {
    const text = "C++ and C# experience; some C too.";
    expect(countKeyword(text, "C++")).toBe(1);
    expect(countKeyword(text, "C#")).toBe(1);
    expect(countKeyword(text, "C")).toBe(1);
    expect(containsKeyword("C++17", "C++")).toBe(false);
  });

  it("handles .NET, Node.js and dotted names", () => {
    expect(containsKeyword("Built on .NET and Azure", ".NET")).toBe(true);
    expect(containsKeyword("ASP.NET Core", "NET")).toBe(false);
    expect(containsKeyword("ASP.NET Core", "ASP.NET")).toBe(true);
    expect(containsKeyword("ASP.NET Core", "ASP")).toBe(false);
    expect(containsKeyword("Node.js services", "Node.js")).toBe(true);
    expect(containsKeyword("Node.js services", "Node")).toBe(false);
    expect(containsKeyword("We use Java.", "Java")).toBe(true);
  });

  it("escapes regex metacharacters", () => {
    expect(containsKeyword("Solid CI/CD pipelines", "CI/CD")).toBe(true);
    expect(containsKeyword("Pandas (Python)", "(Python)")).toBe(true);
    expect(containsKeyword("a+b", "a+b")).toBe(true);
    expect(containsKeyword("aab", "a+b")).toBe(false);
    expect(containsKeyword("Ruby on Rails", "Ruby.*")).toBe(false);
  });
});

describe("keyword matching: Unicode", () => {
  it("respects Cyrillic word boundaries", () => {
    expect(containsKeyword("Опыт работы с Kubernetes и Go", "Go")).toBe(true);
    expect(containsKeyword("Знание SQL обязательно", "SQL")).toBe(true);
    expect(containsKeyword("тестирование", "тест")).toBe(false);
    expect(containsKeyword("Нужен тест-дизайн", "тест")).toBe(true);
    expect(containsKeyword("Коммуникабельность и ответственность", "ответственность")).toBe(true);
  });

  it("matches Cyrillic case-insensitively and doesn't glue to Cyrillic letters", () => {
    expect(containsKeyword("ОТВЕТСТВЕННОСТЬ", "ответственность")).toBe(true);
    expect(containsKeyword("GoЛанг", "Go")).toBe(false);
  });

  it("handles accented Latin and combining marks", () => {
    expect(containsKeyword("Erfahrung mit Datenbanken und Kommunikationsfähigkeit", "Kommunikationsfähigkeit")).toBe(true);
    expect(containsKeyword("Kommunikationsfähigkeit", "Kommunikations")).toBe(false);
    // "e" + combining acute: the mark belongs to the word.
    expect(containsKeyword("Café", "Cafe")).toBe(false);
  });
});

describe("createKeywordMatcher", () => {
  it("prefers the longest keyword where two overlap", () => {
    expect(found("React Native and React", ["React", "React Native"])).toEqual(["React Native", "React"]);
  });

  it("reports which keyword matched, in input order", () => {
    const matches = createKeywordMatcher(["Go", "Rust"])("Rust, then Go");
    expect(matches.map((m) => [m.index, m.keyword])).toEqual([
      [0, 1],
      [11, 0],
    ]);
  });

  it("skips wrong-case hits on case-sensitive keywords but keeps scanning", () => {
    expect(found("go Go golang Google", ["Go"])).toEqual(["Go"]);
    expect(found("it IT", ["IT", "Python"])).toEqual(["IT"]);
  });

  it("returns nothing for an empty keyword list", () => {
    expect(found("anything", [])).toEqual([]);
    expect(found("anything", ["  "])).toEqual([]);
  });
});
