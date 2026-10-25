import { describe, expect, it } from "vitest";
import { filterJobKeywords, filterKeywordList, isJunkKeyword } from "@/features/keywords/filter";
import type { JobKeyword } from "@/types/job";

const job = {
  company: "Acme Robotics GmbH",
  location: "Munich, Bavaria, Germany (Hybrid)",
  position: "Senior Backend Engineer (m/w/d)",
};

const kw = (text: string, kind: JobKeyword["kind"] = "hard"): JobKeyword => ({ text, kind, matchesProfile: true });

describe("isJunkKeyword", () => {
  it("keeps real hard and soft skills", () => {
    for (const skill of [
      "TypeScript",
      "C++",
      "C#",
      ".NET",
      "Node.js",
      "CI/CD",
      "R",
      "Go",
      "machine learning",
      "stakeholder management",
      "communication",
      "team player",
      "Kommunikationsfähigkeit",
      "ответственность",
      "Kubernetes",
    ]) {
      expect(isJunkKeyword(skill, job), skill).toBe(false);
    }
  });

  it("drops the company name, with or without its legal form", () => {
    expect(isJunkKeyword("Acme Robotics GmbH", job)).toBe(true);
    expect(isJunkKeyword("Acme Robotics", job)).toBe(true);
    expect(isJunkKeyword("acme robotics", job)).toBe(true);
    expect(isJunkKeyword("Яндекс", { ...job, company: "ООО Яндекс" })).toBe(false);
    expect(isJunkKeyword("Яндекс", { ...job, company: "Яндекс ООО" })).toBe(true);
  });

  it("drops the location, its parts and any country", () => {
    expect(isJunkKeyword("Munich", job)).toBe(true);
    expect(isJunkKeyword("Bavaria", job)).toBe(true);
    expect(isJunkKeyword("Germany", job)).toBe(true);
    expect(isJunkKeyword("Netherlands", job)).toBe(true);
  });

  it("drops the job title itself", () => {
    expect(isJunkKeyword("Senior Backend Engineer", job)).toBe(true);
    expect(isJunkKeyword("backend development", job)).toBe(false);
  });

  it("drops generic words, work modes and benefits in EN/DE/RU", () => {
    for (const junk of [
      "team",
      "Experience",
      "remote",
      "Hybrid",
      "full-time",
      "health insurance",
      "Stock options",
      "senior",
      "fast-paced environment",
      "Bachelor's degree",
      "Berufserfahrung",
      "Homeoffice",
      "опыт работы",
      "Удалённо",
      "ДМС",
    ]) {
      expect(isJunkKeyword(junk, job), junk).toBe(true);
    }
  });

  it("drops years of experience, money, numbers and lone lowercase letters", () => {
    for (const junk of ["5+ years", "3-5 years of experience", "5 лет", "€60k", "100% remote", "2024", "a", " "]) {
      expect(isJunkKeyword(junk, job), junk).toBe(true);
    }
  });
});

describe("filterJobKeywords", () => {
  it("drops junk and case-insensitive duplicates, keeping order and fields", () => {
    const result = filterJobKeywords(
      [kw("TypeScript"), kw("Acme Robotics"), kw("remote"), kw("communication", "soft"), kw("typescript"), kw("Munich")],
      job,
    );
    expect(result).toEqual([kw("TypeScript"), kw("communication", "soft")]);
  });
});

describe("filterKeywordList", () => {
  it("filters a comma-separated CV value, keeping its separator", () => {
    expect(filterKeywordList("TypeScript, Acme Robotics, Remote, React, team, TypeScript", job)).toBe(
      "TypeScript, React",
    );
    expect(filterKeywordList("Go · Munich · Kubernetes", job)).toBe("Go · Kubernetes");
  });

  it("leaves a value without separators alone unless it's all junk", () => {
    expect(filterKeywordList("Distributed systems", job)).toBe("Distributed systems");
    expect(filterKeywordList("Remote", job)).toBe("");
  });
});
