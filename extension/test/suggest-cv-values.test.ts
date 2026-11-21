import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/types/job";
import type { CvTemplate, CvVariable } from "@/types/cv-template";
import type { DecisionAnswers, DecisionRequest } from "@/features/openai/decisions";

const requestDecisions = vi.fn<(request: DecisionRequest) => Promise<DecisionAnswers>>();
const requestStructured = vi.fn<(request: { userPrompt: string }) => Promise<{ values: { name: string; value: string; reason: string }[] }>>();

vi.mock("@/features/openai/decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/openai/decisions")>()),
  requestDecisions: (request: DecisionRequest) => requestDecisions(request),
}));
vi.mock("@/features/openai/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/openai/client")>()),
  getSupportModel: async () => "gpt-6-luna",
  requestStructured: (request: { userPrompt: string }) => requestStructured(request),
}));
vi.mock("@/features/profile/context", () => ({
  getApplicantContext: async () => ({
    profile: { city: "Berlin", country: "Germany" },
    cvText: "Backend engineer, Go and Kotlin.",
    personalLegend: "Built payment systems.",
  }),
}));

const { suggestCvValues } = await import("@/features/openai/suggest-cv-values");
const { DECISION_THRESHOLDS } = await import("@/features/openai/decisions");

const JOB: Job = {
  company: "Acme",
  position: "Senior Backend Engineer (m/f/d)",
  location: "Munich",
  description: "We build payments in Kotlin. Kotlin everywhere.",
  requirements: [],
  responsibilities: [],
  salary: "",
  techStack: ["Kotlin"],
  contact: "",
  url: "https://acme.example/jobs/1",
};

const stack: CvVariable = { name: "stack", mode: "choice", description: "Main language", options: ["Go", "Kotlin", "Java\nSpring"] };
const title: CvVariable = { name: "job_position", mode: "free", description: "Role", options: ["Backend Engineer"] };
const template = (...variables: CvVariable[]): CvTemplate => ({
  format: "pdf",
  content: variables.map((v) => `{{${v.name}}}`).join(" "),
  variables,
  updatedAt: "",
});
const choice = (name: string, value: string, confidence: number): DecisionAnswers =>
  new Map([[name, { type: "choice", name, choice: value, confidence, probabilities: [] }]]);

afterEach(() => {
  requestDecisions.mockReset();
  requestStructured.mockReset();
});

describe("suggestCvValues", () => {
  it("picks a choice placeholder via Decisions only, with labelled variants and the full text as description", async () => {
    requestDecisions.mockResolvedValue(choice("v0", "o3", 0.9));
    expect(await suggestCvValues(JOB, template(stack))).toEqual([{ name: "stack", value: "Java\nSpring", reason: "AI pick, 90% sure" }]);
    expect(requestStructured).not.toHaveBeenCalled();
    const [question] = requestDecisions.mock.calls[0][0].questions;
    expect(question).toMatchObject({
      type: "choice",
      name: "v0",
      choices: [
        { value: "o1", description: "Go" },
        { value: "o2", description: "Kotlin" },
        { value: "o3", description: "Java\nSpring" },
      ],
    });
    expect(question.instructions).toContain("Main language");
    expect(question.instructions).toContain('o2 ("Kotlin")');
  });

  it("falls back to the offline default below the threshold or on an unknown label", async () => {
    requestDecisions.mockResolvedValue(choice("v0", "o1", DECISION_THRESHOLDS.cvVariableChoice - 0.1));
    expect(await suggestCvValues(JOB, template(stack))).toEqual([{ name: "stack", value: "Kotlin", reason: "" }]);
    requestDecisions.mockResolvedValue(choice("v0", "o9", 0.99));
    expect(await suggestCvValues(JOB, template(stack))).toEqual([{ name: "stack", value: "Kotlin", reason: "" }]);
  });

  it("runs Decisions for choice placeholders and Responses for free ones, together", async () => {
    requestDecisions.mockResolvedValue(choice("v0", "o1", 0.8));
    requestStructured.mockResolvedValue({ values: [{ name: "job_position", value: "Backend Engineer", reason: "Matches the title." }] });
    expect(await suggestCvValues(JOB, template(stack, title))).toEqual([
      { name: "stack", value: "Go", reason: "AI pick, 80% sure" },
      { name: "job_position", value: "Backend Engineer", reason: "Matches the title." },
    ]);
    const prompt = JSON.parse(requestStructured.mock.calls[0][0].userPrompt) as { variables: { name: string }[] };
    expect(prompt.variables.map((v) => v.name)).toEqual(["job_position"]);
  });

  it("skips Decisions when there are only free placeholders", async () => {
    requestStructured.mockResolvedValue({ values: [{ name: "job_position", value: "Backend Engineer", reason: "" }] });
    await suggestCvValues(JOB, template(title));
    expect(requestDecisions).not.toHaveBeenCalled();
  });

  it("lets the Responses call pick the choice placeholders when Decisions fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    requestDecisions.mockRejectedValue(new Error("boom"));
    requestStructured.mockResolvedValue({ values: [{ name: "stack", value: "go ", reason: "Go-heavy CV." }] });
    expect(await suggestCvValues(JOB, template(stack))).toEqual([{ name: "stack", value: "Go", reason: "Go-heavy CV." }]);
    warn.mockRestore();
  });
});
