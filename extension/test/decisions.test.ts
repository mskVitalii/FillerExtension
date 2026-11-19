import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import type { PageCheckbox } from "@/features/autofill/checkboxes";
import type { CustomQuestion } from "@/features/autofill/custom-questions";

vi.mock("@/features/storage/local", () => ({
  getOpenAiApiKey: async () => "sk-test",
  getLocal: async () => "",
}));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ supportModel: "" }) }));
vi.mock("@/features/profile/context", () => ({
  getApplicantContext: async () => ({
    profile: { firstName: "Ada" },
    cvText: "Backend engineer, Go and Kotlin.",
    personalLegend: "Built payment systems.",
    generationRules: "",
    outreachRules: "",
    languageLevels: [{ language: "German", level: "B2" }],
    customFields: [],
    faq: [],
  }),
}));

const { requestDecisions, DECISION_THRESHOLDS } = await import("@/features/openai/decisions");
const { readOptionAnswer, readCheckboxDecision } = await import("@/features/openai/question-decisions");
const { decidePageContent } = await import("@/features/openai/decide-page-content");
const { answerCustomQuestion } = await import("@/features/openai/answer-question");
const { chooseCvWithAi } = await import("@/features/openai/choose-cv");
const { retryRuntime } = await import("@/features/openai/retry");
// A 5xx from Decisions is retried with back-off now; don't wait for real in these tests.
retryRuntime.sleep = async () => {};

const JOB: Job = {
  company: "Acme",
  position: "Backend Engineer",
  location: "Berlin",
  description: "We build payments in Go.",
  requirements: [],
  responsibilities: [],
  salary: "",
  techStack: ["Go"],
  contact: "",
  url: "https://acme.example/jobs/1",
};

type Body = Record<string, unknown> & { questions?: { name: string; type: string }[] };

/** fetch mock: `/v1/decisions` answered by `decide(body)`, `/v1/responses` by `respond(body)`. */
function mockOpenAi(decide: (body: Body) => Response, respond: (body: Body) => unknown = () => ({ questionAnswers: [], checkboxDecisions: [] })) {
  const calls: { url: string; body: Body }[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Body;
    calls.push({ url, body });
    if (url.endsWith("/v1/decisions")) return decide(body);
    const text = JSON.stringify(respond(body));
    return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const ok = (answers: unknown[]) => new Response(JSON.stringify({ answers }));
const predicate = (name: string, probability: number) => ({ type: "predicate", name, probability });
const choice = (name: string, value: string, confidence: number) => ({ type: "choice", name, choice: value, probabilities: [], confidence });

const checkbox = (name: string, label: string, required = false): PageCheckbox =>
  ({ name, label, required, checked: false }) as PageCheckbox;
const question = (id: string, text: string, extra: Partial<CustomQuestion> = {}): CustomQuestion =>
  ({ id, question: text, ...extra }) as CustomQuestion;

afterEach(() => vi.unstubAllGlobals());

describe("requestDecisions", () => {
  it("posts gpt-6-luna with the cache key and maps answers back by name", async () => {
    const calls = mockOpenAi(() => ok([predicate("b", 0.2), predicate("a", 0.9)]));
    const answers = await requestDecisions({
      input: "x",
      promptCacheKey: "k",
      questions: [
        { type: "predicate", name: "a", instructions: "?" },
        { type: "predicate", name: "b", instructions: "?" },
      ],
    });
    expect(calls[0].body).toMatchObject({ model: "gpt-6-luna", prompt_cache_key: "k" });
    expect(answers.get("a")).toMatchObject({ probability: 0.9 });
    expect(answers.get("b")).toMatchObject({ probability: 0.2 });
  });

  it("throws on an HTTP error", async () => {
    mockOpenAi(() => new Response("not found", { status: 404 }));
    await expect(requestDecisions({ input: "x", questions: [{ type: "predicate", name: "a", instructions: "?" }] })).rejects.toThrow("404");
  });
});

describe("thresholds", () => {
  it("fills a single choice only at enough confidence", () => {
    const q = { question: "Pronouns?", options: ["he/him", "she/her", "Prefer not to say"] };
    const sure = readOptionAnswer(q, 0, new Map([["q0", choice("q0", "Prefer not to say", 0.9)]]) as never);
    expect(sure).toEqual({ answer: "Prefer not to say", sufficientInfo: true, confidence: 0.9 });
    const unsure = readOptionAnswer(q, 0, new Map([["q0", choice("q0", "he/him", DECISION_THRESHOLDS.optionChoice - 0.01)]]) as never);
    expect(unsure).toMatchObject({ answer: "", sufficientInfo: false });
  });

  it("select-all: joins the picked options, hands an unsure one to the user", () => {
    const q = { question: "Which do you know?", options: ["Go", "Kotlin", "Rust"], multi: true };
    const answers = (ps: number[]) => new Map(ps.map((p, j) => [`q0_o${j}`, predicate(`q0_o${j}`, p)])) as never;
    expect(readOptionAnswer(q, 0, answers([0.95, 0.9, 0.05]))).toMatchObject({ answer: "Go | Kotlin", sufficientInfo: true });
    expect(readOptionAnswer(q, 0, answers([0.95, 0.55, 0.05]))).toMatchObject({ answer: "", sufficientInfo: false });
  });

  it("never ticks a newsletter, whatever the probability", () => {
    const box = checkbox("news", "Subscribe to our newsletter", true);
    const answers = new Map([["cb0_check", predicate("cb0_check", 0.99)]]) as never;
    expect(readCheckboxDecision(box, 0, answers)).toMatchObject({ check: false });
  });
});

describe("decidePageContent", () => {
  it("decides checkboxes and options via Decisions and writes only gated-in text questions", async () => {
    const calls = mockOpenAi(
      () =>
        ok([
          predicate("cb0_check", 0.97),
          choice("cb0_category", "required-consent", 0.9),
          choice("q0", "Yes", 0.8),
          predicate("facts1", 0.1),
          predicate("facts2", 0.9),
        ]),
      (body) => {
        const prompt = JSON.parse(((body.input as { content: string }[])[1]).content) as { questions: { id: string }[] };
        return { checkboxDecisions: [], questionAnswers: prompt.questions.map((q) => ({ id: q.id, answer: "Because payments.", sufficientInfo: true })) };
      },
    );
    const result = await decidePageContent(
      [checkbox("privacy", "I accept the privacy policy", true)],
      [
        question("a", "Can you work in Germany?", { options: ["Yes", "No"] }),
        question("b", "What is your passport number?"),
        question("c", "Why do you want to join Acme?"),
      ],
      JOB,
    );
    expect(result.checkboxDecisions).toMatchObject([{ name: "privacy", check: true, category: "required-consent" }]);
    expect(result.questionAnswers).toEqual([
      { id: "a", answer: "Yes", sufficientInfo: true, confidence: 0.8 },
      { id: "b", answer: "", sufficientInfo: false },
      { id: "c", answer: "Because payments.", sufficientInfo: true },
    ]);
    const responses = calls.filter((c) => c.url.endsWith("/v1/responses"));
    expect(responses).toHaveLength(1);
    const written = JSON.parse(((responses[0].body.input as { content: string }[])[1]).content) as { questions: { id: string }[]; checkboxes: unknown[] };
    expect(written.questions.map((q) => q.id)).toEqual(["c"]);
    expect(written.checkboxes).toEqual([]);
  });

  it("falls back to the Responses call for everything when Decisions fails", async () => {
    const calls = mockOpenAi(
      () => new Response("unknown endpoint", { status: 404 }),
      () => ({
        checkboxDecisions: [{ index: 0, check: true, category: "required-consent", reason: "privacy" }],
        questionAnswers: [{ id: "a", answer: "Yes", sufficientInfo: true }],
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await decidePageContent(
      [checkbox("privacy", "I accept the privacy policy", true)],
      [question("a", "Can you work in Germany?", { options: ["Yes", "No"] })],
      JOB,
    );
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["decisions", "responses"]);
    expect(result.checkboxDecisions).toMatchObject([{ check: true, reason: "privacy" }]);
    expect(result.questionAnswers).toMatchObject([{ id: "a", answer: "Yes" }]);
  });
});

describe("answerCustomQuestion", () => {
  it("skips generation when the data doesn't cover a factual question", async () => {
    const calls = mockOpenAi(() => ok([predicate("facts0", 0.05)]));
    expect(await answerCustomQuestion("Your salary expectation?", JOB)).toEqual({ answer: "", sufficientInfo: false });
    expect(calls).toHaveLength(1);
  });

  it("generates when the gate passes", async () => {
    const calls = mockOpenAi(
      () => ok([predicate("facts0", 0.9)]),
      () => ({ answer: "I love payments.", sufficientInfo: true }),
    );
    expect(await answerCustomQuestion("Why Acme?", JOB)).toEqual({ answer: "I love payments.", sufficientInfo: true });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["decisions", "responses"]);
  });
});

describe("chooseCvWithAi", () => {
  const cvs = [
    { id: "uuid-en", fileName: "cv-en.pdf", language: "en", text: "English CV" },
    { id: "uuid-de", fileName: "cv-de.pdf", language: "de", text: "Deutscher Lebenslauf" },
  ] as CvMeta[];

  it("maps the cvN label back to the CV id with its confidence", async () => {
    mockOpenAi(() => ok([choice("cv", "cv2", 0.83)]));
    expect(await chooseCvWithAi(JOB, cvs, "German")).toEqual({ cvId: "uuid-de", reason: "", source: "ai", confidence: 0.83 });
  });

  it("returns null below the threshold, so the offline pick stays", async () => {
    mockOpenAi(() => ok([choice("cv", "cv2", DECISION_THRESHOLDS.cvChoice - 0.1)]));
    expect(await chooseCvWithAi(JOB, cvs)).toBeNull();
  });

  it("falls back to the Responses call when Decisions fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockOpenAi(
      () => new Response("nope", { status: 500 }),
      () => ({ cvId: "uuid-en", reason: "English posting" }),
    );
    expect(await chooseCvWithAi(JOB, cvs)).toMatchObject({ cvId: "uuid-en", source: "ai", reason: "English posting" });
  });
});
