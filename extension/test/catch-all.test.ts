import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "@/types/job";
import type { CustomQuestion } from "@/features/autofill/custom-questions";

vi.mock("@/features/storage/local", () => ({
  getOpenAiApiKey: async () => "sk-test",
  getLocal: async () => "Dear Acme team, I build payment systems in Go and want to join you.",
}));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ supportModel: "" }) }));
vi.mock("@/features/profile/context", () => ({
  getApplicantContext: async () => ({
    profile: { firstName: "Ada", email: "ada@example.com", city: "Berlin" },
    cvText: "Backend engineer, Go and Kotlin.",
    personalLegend: "Built payment systems. Will be at GopherCon in March and can meet then.",
    generationRules: "",
    outreachRules: "",
    languageLevels: [],
    customFields: [],
    faq: [],
  }),
}));

const { catchAllKind, isCatchAllField, catchAllPlan, postingSpecificAsk } = await import("@/features/autofill/catch-all");
const { answerCatchAll, trimCatchAllAnswer } = await import("@/features/openai/answer-catch-all");
const { answerCustomQuestion } = await import("@/features/openai/answer-question");
const { decidePageContent } = await import("@/features/openai/decide-page-content");
const { detectCustomQuestions } = await import("@/features/autofill/custom-questions");
const { retryRuntime } = await import("@/features/openai/retry");
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

type Body = Record<string, unknown>;

/** fetch mock: `/v1/decisions` answered by `decide`, `/v1/responses` by `respond` (its JSON is the model's structured output). */
function mockOpenAi(respond: (body: Body) => unknown, decide: () => unknown[] = () => []) {
  const calls: { url: string; body: Body }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as Body;
      calls.push({ url, body });
      if (url.endsWith("/v1/decisions")) return new Response(JSON.stringify({ answers: decide() }));
      const text = JSON.stringify(respond(body));
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
    }),
  );
  return calls;
}

/** The JSON user prompt of a Responses call. */
const promptOf = (body: Body) => JSON.parse((body.input as { content: string }[])[1].content) as Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

describe("catch-all detection by label", () => {
  it.each([
    "Additional information",
    "Additional Information (optional)",
    "Anything else you'd like to share?",
    "Is there anything else you would like us to know?",
    "Weitere Informationen",
    "Zusätzliche Angaben",
    "Sonstiges",
    "Möchten Sie uns noch etwas mitteilen?",
    "Message to the hiring team",
    "Any additional comments",
    "Дополнительная информация",
  ])("%s is a strong catch-all", (label) => {
    expect(catchAllKind(label)).toBe("strong");
  });

  it.each(["Why do you want to join Acme?", "Notice period", "Gehaltsvorstellung", "Describe a project you are proud of", "Additional information: please state your notice period and salary expectation"])(
    "%s is a real question",
    (label) => {
      expect(catchAllKind(label)).toBeNull();
    },
  );

  it("a one-word Comments/Nachricht counts only as the last free-text field", () => {
    expect(catchAllKind("Comments")).toBe("weak");
    expect(isCatchAllField("Nachricht", { isLastTextField: true })).toBe(true);
    expect(isCatchAllField("Nachricht", { isLastTextField: false })).toBe(false);
  });

  it("a cover-letter text box counts only when the letter is already attached", () => {
    expect(isCatchAllField("Cover letter (optional)", { coverLetterAttached: true })).toBe(true);
    expect(isCatchAllField("Cover letter (optional)", { coverLetterAttached: false })).toBe(false);
  });
});

describe("catch-all plan", () => {
  it("skips an optional one when the posting asks for nothing specific", () => {
    expect(catchAllPlan(JOB, { required: false })).toEqual({ action: "skip" });
  });

  it("writes a required one, or one the posting asks something specific for", () => {
    expect(catchAllPlan(JOB, { required: true })).toMatchObject({ action: "write", reason: "required" });
    const asking = { ...JOB, description: "Please mention the code word 'kiwi' in your application." };
    expect(postingSpecificAsk(asking)).toMatch(/kiwi/);
    expect(catchAllPlan(asking, { required: false })).toMatchObject({ action: "write", reason: "posting" });
  });

  it("lets the model decide when requiredness is unknown", () => {
    expect(catchAllPlan(JOB, {})).toMatchObject({ action: "write", reason: "asked" });
  });
});

describe("trimCatchAllAnswer", () => {
  it("keeps at most two sentences and drops ones with links, emails or phone numbers", () => {
    expect(
      trimCatchAllAnswer("Reach me at ada@example.com. My GitHub is github.com/ada. I can meet at GopherCon in March. Thanks. Bye."),
    ).toBe("I can meet at GopherCon in March. Thanks.");
  });
});

describe("answerCatchAll", () => {
  it("leaves an optional catch-all empty without calling the model", async () => {
    const calls = mockOpenAi(() => ({ skip: false, answer: "should not be used" }));
    expect(await answerCatchAll("Additional information", JOB, { required: false })).toEqual({ answer: "", sufficientInfo: true, skipped: true });
    expect(calls).toHaveLength(0);
  });

  it("writes a short, non-repeating answer for a required one, given what the form already holds", async () => {
    const calls = mockOpenAi(() => ({
      skip: false,
      answer: "I will be at GopherCon in March and could meet the team there. You can reach me at ada@example.com. I look forward to hearing from you.",
    }));
    const result = await answerCatchAll("Additional information", JOB, {
      required: true,
      formValues: [{ label: "Email", value: "ada@example.com" }],
      otherAnswers: [{ question: "Why Acme?", answer: "Payments in Go." }],
    });
    expect(result).toEqual({
      answer: "I will be at GopherCon in March and could meet the team there. I look forward to hearing from you.",
      sufficientInfo: true,
      skipped: false,
    });
    expect(calls).toHaveLength(1);
    const prompt = promptOf(calls[0].body);
    expect(prompt.formValues).toEqual([{ label: "Email", value: "ada@example.com" }]);
    expect(prompt.otherAnswers).toEqual([{ question: "Why Acme?", answer: "Payments in Go." }]);
    expect(prompt.required).toBe(true);
    const schema = (calls[0].body.text as { format: { schema: { properties: Record<string, unknown> } } }).format.schema;
    expect(Object.keys(schema.properties)).toContain("skip");
  });

  it("honours the model's skip, and flags a required field left empty for the user", async () => {
    mockOpenAi(() => ({ skip: true, answer: "" }));
    expect(await answerCatchAll("Additional information", JOB, {})).toEqual({ answer: "", sufficientInfo: true, skipped: true });
    expect(await answerCatchAll("Additional information", JOB, { required: true })).toEqual({ answer: "", sufficientInfo: false, skipped: true });
  });
});

describe("answerCatchAll Decisions gate", () => {
  const gate = (probability: number) => () => [{ type: "predicate", name: "catchAllAdds", probability }];
  const asking: Job = { ...JOB, description: "We build payments in Go. In your application, please tell us your earliest start date." };

  it("skips a non-required catch-all without a Responses call when the gate says there is nothing new", async () => {
    const calls = mockOpenAi(() => ({ skip: false, answer: "should not be used" }), gate(0.1));
    expect(await answerCatchAll("Additional information", JOB, {})).toEqual({ answer: "", sufficientInfo: true, skipped: true });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["decisions"]);
    const questions = calls[0].body.questions as { name: string; instructions: string }[];
    expect(questions.map((q) => q.name)).toEqual(["catchAllAdds"]);
    const input = calls[0].body.input as { content: unknown }[];
    expect(JSON.stringify(input[input.length - 1])).toContain("Additional information");
  });

  it("writes it when the gate passes, and passes the posting's ask to the gate", async () => {
    const calls = mockOpenAi(() => ({ skip: false, answer: "I can start on 1 March." }), gate(0.8));
    expect(await answerCatchAll("Additional information", asking, { required: false })).toEqual({
      answer: "I can start on 1 March.",
      sufficientInfo: true,
      skipped: false,
    });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["decisions", "responses"]);
    const questions = calls[0].body.questions as { instructions: string }[];
    expect(questions[0].instructions).toContain("postingAsk");
  });

  it("the generation can still skip after the gate passed", async () => {
    mockOpenAi(() => ({ skip: true, answer: "" }), gate(0.6));
    expect(await answerCatchAll("Additional information", JOB, {})).toEqual({ answer: "", sufficientInfo: true, skipped: true });
  });

  it("falls back to generating when the Decisions call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url.split("/").pop() ?? "");
        if (url.endsWith("/v1/decisions")) return new Response("bad request", { status: 400 });
        const text = JSON.stringify({ skip: false, answer: "I can meet the team at GopherCon in March." });
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }));
      }),
    );
    expect(await answerCatchAll("Additional information", JOB, {})).toMatchObject({ answer: "I can meet the team at GopherCon in March.", skipped: false });
    expect(calls[calls.length - 1]).toBe("responses");
    warn.mockRestore();
  });

  it("never gates a required field", async () => {
    const calls = mockOpenAi(() => ({ skip: false, answer: "I look forward to hearing from you." }), gate(0));
    expect(await answerCatchAll("Additional information", JOB, { required: true })).toMatchObject({ skipped: false });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["responses"]);
  });
});

describe("answerCustomQuestion with a catch-all", () => {
  it("routes an explicit optional catch-all to the skip, not the question pipeline", async () => {
    const calls = mockOpenAi(() => ({ answer: "A long summary of my CV.", sufficientInfo: true }));
    expect(await answerCustomQuestion("Anything else you'd like to share?", JOB, undefined, false, undefined, false, undefined, { required: false })).toMatchObject({
      answer: "",
      skipped: true,
    });
    expect(calls).toHaveLength(0);
  });

  it("recognises a catch-all by its label when no context is passed (requiredness unknown → model may skip)", async () => {
    const calls = mockOpenAi(() => ({ skip: true, answer: "" }));
    expect(await answerCustomQuestion("Weitere Informationen", JOB)).toMatchObject({ answer: "", skipped: true });
    expect(calls.map((c) => c.url.split("/").pop())).toEqual(["decisions", "responses"]);
  });
});

describe("decidePageContent with a catch-all", () => {
  const q = (id: string, text: string, extra: Partial<CustomQuestion> = {}): CustomQuestion => ({ id, question: text, ...extra });

  it("skips an optional catch-all and keeps it out of the batch the model writes", async () => {
    const calls = mockOpenAi(
      (body) => {
        const prompt = promptOf(body) as { questions?: { id: string }[] };
        return { checkboxDecisions: [], questionAnswers: (prompt.questions ?? []).map((x) => ({ id: x.id, answer: "Payments in Go.", sufficientInfo: true })) };
      },
      () => [{ type: "predicate", name: "facts0", probability: 0.9 }],
    );
    const result = await decidePageContent([], [q("a", "Why Acme?"), q("b", "Additional information", { catchAll: true, required: false })], JOB);
    expect(result.questionAnswers).toEqual([
      { id: "a", answer: "Payments in Go.", sufficientInfo: true },
      { id: "b", answer: "", sufficientInfo: true },
    ]);
    const written = calls.filter((c) => c.url.endsWith("/v1/responses")).map((c) => promptOf(c.body) as { questions?: { id: string }[] });
    expect(written).toHaveLength(1);
    expect(written[0].questions?.map((x) => x.id)).toEqual(["a"]);
  });

  it("answers a required catch-all after the others, passing their answers along", async () => {
    const calls = mockOpenAi(
      (body) => {
        const prompt = promptOf(body) as { questions?: { id: string }[] };
        if (prompt.questions) return { checkboxDecisions: [], questionAnswers: prompt.questions.map((x) => ({ id: x.id, answer: "Payments in Go.", sufficientInfo: true })) };
        return { skip: false, answer: "I could meet the team at GopherCon in March." };
      },
      () => [{ type: "predicate", name: "facts0", probability: 0.9 }],
    );
    const result = await decidePageContent([], [q("a", "Why Acme?"), q("b", "Sonstiges", { catchAll: true, required: true })], JOB);
    expect(result.questionAnswers[1]).toEqual({ id: "b", answer: "I could meet the team at GopherCon in March.", sufficientInfo: true });
    const catchAllCall = calls.filter((c) => c.url.endsWith("/v1/responses")).map((c) => promptOf(c.body)).find((p) => p.question === "Sonstiges");
    expect(catchAllCall?.otherAnswers).toEqual([{ question: "Why Acme?", answer: "Payments in Go." }]);
  });
});

describe("detectCustomQuestions marks catch-alls", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email</label><input id="email" name="email" type="email" value="ada@example.com">
        <label for="why">Why do you want to join Acme?</label><textarea id="why"></textarea>
        <label for="extra">Anything else you'd like to share?</label><textarea id="extra"></textarea>
        <label for="msg">Comments *</label><textarea id="msg" required></textarea>
      </form>`;
  });

  it("flags the catch-alls with requiredness and the form's other values, and leaves real questions alone", async () => {
    const questions = await detectCustomQuestions();
    const byText = new Map(questions.map((x) => [x.question, x]));
    expect(byText.get("Why do you want to join Acme?")?.catchAll).toBeUndefined();
    expect(byText.get("Anything else you'd like to share?")).toMatchObject({ catchAll: true, required: false });
    expect(byText.get("Anything else you'd like to share?")?.formValues).toContainEqual({ label: "Email", value: "ada@example.com" });
    expect(byText.get("Comments")).toMatchObject({ catchAll: true, required: true });
  });
});
