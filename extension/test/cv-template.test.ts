import { describe, expect, it } from "vitest";
import { EMPTY_JOB, type Job } from "@/types/job";
import {
  MARK_CLOSE,
  MARK_OPEN,
  defaultValue,
  extractVariableNames,
  fillTemplate,
  findOptionsInPosting,
  normalizePlaceholders,
  stripMarks,
  syncVariables,
} from "@/features/cv-template/template";
import { parsePlainText } from "@/features/cv-template/preview";
import { initialVariable, valueFromJob } from "@/features/cv-template/defaults";

const job = (overrides: Partial<Job>): Job => ({ ...EMPTY_JOB, ...overrides });

describe("template placeholders", () => {
  it("extracts names in first-appearance order, deduplicated, tolerating inner spaces", () => {
    expect(extractVariableNames("{{ city }} {{job_position}} {{city}} {{main-language}}")).toEqual([
      "city",
      "job_position",
      "main-language",
    ]);
  });

  it("fills every occurrence and leaves a missing value empty", () => {
    expect(fillTemplate("{{a}} and {{a}}, {{b}}.", { a: "Go" })).toBe("Go and Go, .");
  });

  it("marks a multi-line value line by line so a highlight never spans a line break", () => {
    const filled = fillTemplate("Stack: {{bullets}}", { bullets: "Go\ngRPC" }, { mark: true });
    expect(filled).toBe(`Stack: ${MARK_OPEN}Go${MARK_CLOSE}\n${MARK_OPEN}gRPC${MARK_CLOSE}`);
    const blocks = parsePlainText(filled);
    expect(blocks).toEqual([
      { type: "line", spans: [{ text: "Stack: ", mark: false }, { text: "Go", mark: true }] },
      { type: "line", spans: [{ text: "gRPC", mark: true }] },
    ]);
    expect(stripMarks(filled)).toBe("Stack: Go\ngRPC");
  });

  it("closes a space a PDF text extractor put inside a placeholder", () => {
    expect(normalizePlaceholders("{{cit y}}, Germany · { {job_position} }")).toBe("{{city}}, Germany · {{job_position}}");
    expect(normalizePlaceholders("no {braces} here")).toBe("no {braces} here");
  });

  it("keeps definitions of placeholders removed from the template instead of dropping them", () => {
    const synced = syncVariables("{{new_one}} {{city}}", [
      { name: "city", description: "d", options: ["Berlin"], mode: "free" },
      { name: "typo", description: "", options: ["x"], mode: "choice" },
    ]);
    expect(synced.map((v) => v.name)).toEqual(["new_one", "city", "typo"]);
    expect(synced[1].options).toEqual(["Berlin"]);
  });

  it("a newly found known placeholder starts from its built-in definition, an unknown one blank", () => {
    const [city, keywords, custom] = syncVariables("{{city}} {{keywords}} {{go_bullets}}", []);
    expect(city).toMatchObject({ name: "city", mode: "free", options: [] });
    expect(city.description).toMatch(/city of the job/i);
    expect(keywords.mode).toBe("free");
    expect(custom).toEqual({ name: "go_bullets", description: "", options: [], mode: "choice" });
    expect(initialVariable("Position").description).toMatch(/job title/i);
  });
});

describe("findOptionsInPosting", () => {
  it("ranks options by how often the posting mentions them", () => {
    const posting = job({
      position: "Senior Backend Engineer",
      description: "We use Go everywhere. Some Python scripts. Go services, Go tooling.",
      techStack: ["Go", "PostgreSQL"],
    });
    expect(findOptionsInPosting(["Python", "Go", "C#", "JavaScript"], posting)).toEqual(["Go", "Python"]);
  });

  it("doesn't match C inside C# / C++ or Go inside Google", () => {
    const posting = job({ description: "Experience with C# and C++; you'll work at Google." });
    expect(findOptionsInPosting(["C", "Go", "C#"], posting)).toEqual(["C#"]);
  });

  it("matches multi-word titles case-insensitively and skips multi-line block options", () => {
    const posting = job({ position: "Full-Stack developer (m/w/d)" });
    expect(findOptionsInPosting(["Full-Stack Developer", "- Built X\n- Built Y"], posting)).toEqual([
      "Full-Stack Developer",
    ]);
  });

  it("defaults to the most-mentioned option, else the first", () => {
    const variable = { name: "main_language", description: "", options: ["Go", "C#", "Python"], mode: "choice" as const };
    expect(defaultValue(variable, job({ description: "Python and more Python" }))).toBe("Python");
    expect(defaultValue(variable, EMPTY_JOB)).toBe("Go");
  });

  it("fills a known free placeholder straight from the posting when no variant matches", () => {
    const posting = job({ position: "Backend Engineer (m/w/d)", company: "Staffbase", location: "Chemnitz, Germany (Hybrid)" });
    expect(defaultValue(initialVariable("city"), posting)).toBe("Chemnitz");
    expect(defaultValue(initialVariable("country"), posting)).toBe("Germany");
    expect(defaultValue(initialVariable("job_position"), posting)).toBe("Backend Engineer");
    expect(defaultValue(initialVariable("company"), posting)).toBe("Staffbase");
    // A variant the posting mentions still wins; a choice with variants never takes a free value.
    expect(defaultValue({ ...initialVariable("city"), options: ["Berlin", "Chemnitz"] }, posting)).toBe("Chemnitz");
    expect(defaultValue({ name: "city", description: "", options: ["Berlin"], mode: "choice" }, posting)).toBe("Berlin");
    expect(valueFromJob("city", job({ location: "Remote" }))).toBe("");
    expect(valueFromJob("city", job({ location: "Frankfurt am Main, Hesse, Germany" }))).toBe("Frankfurt am Main");
  });
});
