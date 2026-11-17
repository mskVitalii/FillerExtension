import { describe, expect, it } from "vitest";
import { EMPTY_JOB, type Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import { guessTextLanguage, pickCvForPosting, rulesScore, withDefaultForLanguage } from "@/features/cv-selection/select";
import { languageCode } from "@/lib/language-codes";

function cv(id: string, extra: Partial<CvMeta> = {}): CvMeta {
  return { id, fileName: `${id}.pdf`, mimeType: "application/pdf", driveFileId: null, text: "", uploadedAt: "", ...extra };
}

function job(extra: Partial<Job> = {}): Job {
  return { ...EMPTY_JOB, url: "https://example.com/job", ...extra };
}

const GERMAN_TEXT =
  "Wir suchen eine erfahrene Backend-Entwicklerin für unser Team in Berlin. Du arbeitest mit Go und Kubernetes, " +
  "und du bringst Erfahrung mit verteilten Systemen mit. Deine Aufgaben sind die Entwicklung und der Betrieb unserer " +
  "Plattform. Wir bieten dir flexible Arbeitszeiten und die Möglichkeit, im Homeoffice zu arbeiten. Kenntnisse in SQL sind ein Plus.";
const ENGLISH_TEXT =
  "We are looking for an experienced backend engineer to join our team in Berlin. You will work with Go and Kubernetes, " +
  "and you have experience with distributed systems. Your role is to build and run our platform. We offer flexible hours " +
  "and the option to work remotely. Skills in SQL are a plus and you will own the services end to end.";

describe("languageCode", () => {
  it("maps names, codes and locales to ISO codes", () => {
    expect(languageCode("German")).toBe("de");
    expect(languageCode("english")).toBe("en");
    expect(languageCode("de-DE")).toBe("de");
    expect(languageCode("Deutsch")).toBe("de");
    expect(languageCode("Klingon")).toBeNull();
  });
});

describe("guessTextLanguage", () => {
  it("tells German from English postings", () => {
    expect(guessTextLanguage(GERMAN_TEXT)).toBe("de");
    expect(guessTextLanguage(ENGLISH_TEXT)).toBe("en");
  });
  it("stays out of short or ambiguous text", () => {
    expect(guessTextLanguage("Backend Engineer")).toBeNull();
  });
});

describe("pickCvForPosting", () => {
  const de = cv("de", { language: "de", isDefaultForLanguage: true });
  const deFrontend = cv("de-frontend", { language: "de", rules: "Frontend React TypeScript" });
  const en = cv("en", { language: "en", isDefaultForLanguage: true });
  const enGo = cv("en-go", { language: "en", rules: "Backend Go Kubernetes" });

  it("uses the brief's posting language over the text", () => {
    const choice = pickCvForPosting([de, en], job({ description: ENGLISH_TEXT }), ["German"]);
    expect(choice?.cvId).toBe("de");
    expect(choice?.source).toBe("language");
  });

  it("guesses the language from the text without a brief", () => {
    expect(pickCvForPosting([de, en], job({ description: GERMAN_TEXT }))?.cvId).toBe("de");
    expect(pickCvForPosting([de, en], job({ description: ENGLISH_TEXT }))?.cvId).toBe("en");
  });

  it("prefers the CV whose rules match the posting, within the language", () => {
    const choice = pickCvForPosting([en, enGo, de], job({ position: "Backend Engineer", description: ENGLISH_TEXT }), ["English"]);
    expect(choice).toMatchObject({ cvId: "en-go", source: "rules" });
  });

  it("falls back to the default for the language when no rule matches better", () => {
    const choice = pickCvForPosting([deFrontend, de], job({ position: "Backend-Entwickler", description: GERMAN_TEXT }), ["German"]);
    expect(choice?.cvId).toBe("de");
  });

  it("falls back to the English CV when none is in the posting's language", () => {
    const choice = pickCvForPosting([de, en], job({ description: "x" }), ["French"]);
    expect(choice?.cvId).toBe("en");
  });

  it("picks nothing when the language is unknown", () => {
    expect(pickCvForPosting([de, en], job({ description: "short" }))).toBeNull();
  });
});

describe("rulesScore", () => {
  it("weights title matches above body matches", () => {
    const posting = job({ position: "Go Developer", description: "We use kubernetes daily." });
    expect(rulesScore("Go, Kubernetes", posting)).toBeGreaterThan(rulesScore("Kubernetes", posting));
    expect(rulesScore(undefined, posting)).toBe(0);
  });
});

describe("withDefaultForLanguage", () => {
  it("keeps one default per language", () => {
    const items = withDefaultForLanguage(
      [cv("a", { language: "de", isDefaultForLanguage: true }), cv("b", { language: "de" }), cv("c", { language: "en", isDefaultForLanguage: true })],
      "b",
    );
    expect(items.map((item) => item.isDefaultForLanguage)).toEqual([false, true, true]);
  });
});
