import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/types/job";
import { fieldsToFill, keepUserEdits, mergeCompletion, type JobCompletion } from "@/features/job-extraction/completion";
import { pageMainText } from "@/features/job-extraction/dom-heuristics";

const requestStructured = vi.fn();
vi.mock("@/features/openai/client", () => ({
  requestStructured: (...args: unknown[]) => requestStructured(...args),
  getExtractionModel: async () => "test-model",
}));
vi.mock("@/features/profile/context", () => ({
  getApplicantContext: async () => ({ profile: {}, cvText: "", personalLegend: "" }),
}));

const { completeJobWithAiAndBrief } = await import("@/features/job-extraction/ai-fallback");

const LONG_DESCRIPTION = "We build payment infrastructure. ".repeat(10);

function domJob(extra: Partial<Job> = {}): Job {
  return {
    position: "Backend Engineer at Acme | LinkedIn",
    company: "",
    location: "",
    description: LONG_DESCRIPTION,
    requirements: [],
    responsibilities: ["Own the payments API"],
    salary: null,
    techStack: ["Go"],
    contact: null,
    url: "https://jobs.example.com/1",
    ...extra,
  };
}

function completion(extra: Partial<JobCompletion> = {}): JobCompletion {
  return {
    position: "Backend Engineer",
    company: "Acme",
    location: "Berlin",
    requirements: ["5+ years of Go"],
    responsibilities: ["should be ignored"],
    techStack: ["should be ignored"],
    salary: null,
    contact: null,
    ...extra,
  };
}

describe("fieldsToFill", () => {
  it("always asks for title/company/location, and only the lists the DOM left empty", () => {
    expect(fieldsToFill(domJob())).toEqual(["position", "company", "location", "requirements", "salary", "contact"]);
  });
});

describe("mergeCompletion", () => {
  it("fills only the asked-for fields and keeps the page's description", () => {
    const dom = domJob();
    const job = mergeCompletion(dom, completion(), fieldsToFill(dom), "page text");
    expect(job).toMatchObject({
      position: "Backend Engineer",
      company: "Acme",
      location: "Berlin",
      requirements: ["5+ years of Go"],
      responsibilities: ["Own the payments API"],
      techStack: ["Go"],
      description: LONG_DESCRIPTION,
      url: dom.url,
    });
  });

  it("keeps the DOM value when the AI left a field empty", () => {
    const dom = domJob({ location: "Remote" });
    expect(mergeCompletion(dom, completion({ location: "" }), fieldsToFill(dom), "").location).toBe("Remote");
  });

  it("takes the description from the page text when the DOM one is a stub", () => {
    const dom = domJob({ description: "Apply now" });
    const job = mergeCompletion(dom, completion(), fieldsToFill(dom), `  ${LONG_DESCRIPTION}\n\n More.  `);
    expect(job.description).toBe(`${LONG_DESCRIPTION.trim()} More.`);
  });
});

describe("keepUserEdits", () => {
  it("applies completed fields except the ones the user changed meanwhile", () => {
    const dom = domJob();
    const current = { ...dom, location: "Munich (typed by the user)" };
    const completed = { ...dom, company: "Acme", location: "Berlin" };
    expect(keepUserEdits(current, dom, completed)).toMatchObject({ company: "Acme", location: "Munich (typed by the user)" });
  });
});

describe("completeJobWithAiAndBrief", () => {
  beforeEach(() => requestStructured.mockReset());

  it("sends the gaps, not a request to re-type the posting, at low reasoning effort", async () => {
    requestStructured.mockResolvedValue({
      ...completion(),
      postingLanguages: ["English"],
      languageRequirements: [],
      keywords: [],
    });
    const { job, brief } = await completeJobWithAiAndBrief(domJob(), "page text");

    const request = requestStructured.mock.calls[0][0];
    expect(request.reasoningEffort).toBe("low");
    expect(request.schema.properties).not.toHaveProperty("description");
    expect(JSON.parse(request.userPrompt).fieldsToFill).toEqual(fieldsToFill(domJob()));
    expect(job.company).toBe("Acme");
    expect(job.description).toBe(LONG_DESCRIPTION);
    expect(brief.language?.postingLanguages).toEqual(["English"]);
  });
});

describe("pageMainText", () => {
  it("reads the main region, not the nav and footer around it", () => {
    document.body.innerHTML = `<nav>Jobs Companies Sign in</nav><main>${LONG_DESCRIPTION.repeat(2)}</main><footer>Cookies</footer>`;
    const text = pageMainText(document);
    expect(text).toContain("payment infrastructure");
    expect(text).not.toContain("Sign in");
    expect(text).not.toContain("Cookies");
  });

  it("falls back to the whole body when the region is only a card", () => {
    document.body.innerHTML = `<article>Similar job</article><div>${LONG_DESCRIPTION.repeat(2)}</div>`;
    expect(pageMainText(document)).toContain("payment infrastructure");
  });
});
