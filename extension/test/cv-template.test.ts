import { describe, expect, it } from "vitest";
import { EMPTY_JOB, type Job } from "@/types/job";
import {
  MARK_CLOSE,
  MARK_OPEN,
  defaultValue,
  extractVariableNames,
  fillTemplate,
  findOptionsInPosting,
  stripMarks,
  syncVariables,
} from "@/features/cv-template/template";
import { parseCvMarkdown, parseInline, type CvBlock } from "@/features/cv-template/markdown";

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

  it("marks a multi-line value line by line so the parser still sees bullets", () => {
    const filled = fillTemplate("{{bullets}}", { bullets: "- one\n- two" }, { mark: true });
    expect(filled).toBe(`${MARK_OPEN}- one${MARK_CLOSE}\n${MARK_OPEN}- two${MARK_CLOSE}`);
    const blocks = parseCvMarkdown(filled);
    expect(blocks.map((b) => b.type)).toEqual(["bullet", "bullet"]);
    expect(blocks[0]).toMatchObject({ left: [{ text: "one", mark: true }] });
    expect(stripMarks(filled)).toBe("- one\n- two");
  });

  it("keeps definitions of placeholders removed from the template instead of dropping them", () => {
    const synced = syncVariables("{{new_one}} {{city}}", [
      { name: "city", description: "d", options: ["Berlin"], mode: "free" },
      { name: "typo", description: "", options: ["x"], mode: "choice" },
    ]);
    expect(synced.map((v) => v.name)).toEqual(["new_one", "city", "typo"]);
    expect(synced[1].options).toEqual(["Berlin"]);
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
});

describe("parseCvMarkdown", () => {
  const types = (blocks: CvBlock[]) => blocks.map((b) => (b.type === "heading" ? `h${b.level}` : b.type));

  it("parses headings, right-aligned parts, bullets, rules and collapses gaps", () => {
    const blocks = parseCvMarkdown(
      "# Jane Doe\nBackend Engineer · Berlin\n\n\n## Experience\n### Acme || 2021 – now\n- Built things\n  - nested\n---\n",
    );
    expect(types(blocks)).toEqual(["h1", "line", "gap", "h2", "h3", "bullet", "bullet", "rule"]);
    const entry = blocks[4] as Extract<CvBlock, { type: "heading" }>;
    expect(entry.left.map((s) => s.text).join("")).toBe("Acme");
    expect(entry.right?.map((s) => s.text).join("")).toBe("2021 – now");
    expect(blocks[6]).toMatchObject({ type: "bullet", depth: 1 });
  });

  it("parses bold, italic, links and escaped asterisks", () => {
    const spans = parseInline("**Go**, *gRPC* and [GitHub](https://github.com/x) \\*");
    expect(spans).toEqual([
      { text: "Go", bold: true, italic: false, mark: false, link: undefined },
      { text: ", ", bold: false, italic: false, mark: false, link: undefined },
      { text: "gRPC", bold: false, italic: true, mark: false, link: undefined },
      { text: " and ", bold: false, italic: false, mark: false, link: undefined },
      { text: "GitHub", bold: false, italic: false, mark: false, link: "https://github.com/x" },
      { text: " *", bold: false, italic: false, mark: false, link: undefined },
    ]);
  });

  it("treats *italic* at line start as text, not a bullet", () => {
    expect(parseCvMarkdown("*Remote-friendly*")[0].type).toBe("line");
  });
});
