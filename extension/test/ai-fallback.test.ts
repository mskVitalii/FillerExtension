import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keys = { openai: "sk-test" as string | undefined, anthropic: "sk-ant-test" as string | undefined };
const prefs = { supportModel: "", coverLetterModel: "", outreachModel: "", aiFallbackPolicy: "unavailable", claudeMainModel: "", claudeSupportModel: "" };

vi.mock("@/features/storage/local", () => ({
  getOpenAiApiKey: async () => keys.openai,
  getAnthropicApiKey: async () => keys.anthropic,
}));
vi.mock("@/features/storage/sync", () => ({ getPreferences: async () => ({ ...prefs }) }));

const { requestStructured, requestTextStream, OpenAiQuotaError } = await import("@/features/openai/client");
const { requestDecisions } = await import("@/features/openai/decisions");
const { onAiFallback } = await import("@/features/openai/fallback");
const { toClaudeSchema } = await import("@/features/openai/anthropic");
const { retryRuntime } = await import("@/features/openai/retry");

const OPENAI_OK = { output: [{ type: "message", content: [{ type: "output_text", text: '{"ok":"openai"}' }] }] };
const QUOTA = JSON.stringify({ error: { code: "credit_balance_exhausted", message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.", param: null, type: "insufficient_quota" } }, null, 2);
const OVERLOADED = '{"error":{"message":"Our servers are currently overloaded.","type":"service_unavailable_error","code":"server_is_overloaded"}}';

function claudeMessage(text: string, model = "claude-haiku-5-5") {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function claudeSse(text: string): Response {
  const events: [string, object][] = [
    ["message_start", { type: "message_start", message: { ...claudeMessage(""), content: [], stop_reason: null } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ...text.split(" ").map((word, i): [string, object] => ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: i ? ` ${word}` : word } }]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  const body = events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

type Route = (url: string, body: Record<string, unknown>) => Response | Promise<Response>;
let openaiRoute: Route;
let claudeRoute: Route;
const calls: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];

function structured() {
  return requestStructured({
    systemPrompt: "sys",
    userPrompt: "user",
    schemaName: "x",
    schema: { type: "object", properties: { ok: { type: "string" } }, required: ["ok"], additionalProperties: false },
    parse: (raw) => JSON.parse(raw) as { ok: string },
  });
}

describe("Claude fallback", () => {
  const realSleep = retryRuntime.sleep;
  beforeEach(() => {
    calls.length = 0;
    keys.openai = "sk-test";
    keys.anthropic = "sk-ant-test";
    prefs.aiFallbackPolicy = "unavailable";
    retryRuntime.sleep = async () => {};
    vi.spyOn(console, "warn").mockImplementation(() => {});
    openaiRoute = () => new Response(OVERLOADED, { status: 503 });
    claudeRoute = () => json(claudeMessage('{"ok":"claude"}'));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const raw = init?.headers as { get?: (name: string) => string | null } | undefined;
        const headers = new Headers();
        for (const name of ["x-api-key", "anthropic-dangerous-direct-browser-access", "anthropic-beta", "authorization"]) {
          const value = typeof raw?.get === "function" ? raw.get(name) : (raw as Record<string, string> | undefined)?.[name];
          if (value) headers.set(name, value);
        }
        calls.push({ url, body, headers });
        return url.startsWith("https://api.anthropic.com/") ? claudeRoute(url, body) : openaiRoute(url, body);
      }),
    );
  });
  afterEach(() => {
    retryRuntime.sleep = realSleep;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const openaiCalls = () => calls.filter((c) => c.url.startsWith("https://api.openai.com/"));
  const claudeCalls = () => calls.filter((c) => c.url.startsWith("https://api.anthropic.com/"));

  it("answers with Claude once OpenAI stays overloaded through its retries, and announces it", async () => {
    const notices: { model: string; reason: string }[] = [];
    const off = onAiFallback((n) => notices.push(n));
    expect(await structured()).toEqual({ ok: "claude" });
    off();
    expect(openaiCalls()).toHaveLength(4);
    expect(claudeCalls()).toHaveLength(1);
    const { body, headers } = claudeCalls()[0];
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.system).toBe("sys");
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(headers.get("authorization")).toBe("Bearer sk-ant-test");
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(notices).toEqual([expect.objectContaining({ model: "claude-haiku-5-5", reason: "OpenAI 503" })]);
  });

  it("uses no Claude when OpenAI recovers within its retries", async () => {
    let n = 0;
    openaiRoute = () => (++n < 3 ? new Response(OVERLOADED, { status: 503 }) : json(OPENAI_OK));
    expect(await structured()).toEqual({ ok: "openai" });
    expect(claudeCalls()).toHaveLength(0);
  });

  it("keeps OpenAI's error when the policy is off", async () => {
    prefs.aiFallbackPolicy = "off";
    await expect(structured()).rejects.toThrow(/\(503\)/);
    expect(claudeCalls()).toHaveLength(0);
  });

  it("keeps OpenAI's error without an Anthropic key", async () => {
    keys.anthropic = undefined;
    await expect(structured()).rejects.toThrow(/server_is_overloaded/);
    expect(claudeCalls()).toHaveLength(0);
  });

  it("doesn't fall back on a 401 under 'unavailable', but does under 'any'", async () => {
    openaiRoute = () => new Response("bad key", { status: 401 });
    await expect(structured()).rejects.toThrow(/\(401\)/);
    expect(openaiCalls()).toHaveLength(1);
    expect(claudeCalls()).toHaveLength(0);

    prefs.aiFallbackPolicy = "any";
    expect(await structured()).toEqual({ ok: "claude" });
  });

  it("never retries a 429 that says the account is out of credits, and still falls back to Claude", async () => {
    openaiRoute = () => new Response(QUOTA, { status: 429 });
    const notices: { reason: string }[] = [];
    const off = onAiFallback((n) => notices.push(n));
    expect(await structured()).toEqual({ ok: "claude" });
    off();
    expect(openaiCalls()).toHaveLength(1);
    expect(notices).toEqual([expect.objectContaining({ reason: "OpenAI out of credits" })]);
  });

  it("throws a typed OpenAiQuotaError with OpenAI's own message when nothing can fall back", async () => {
    prefs.aiFallbackPolicy = "off";
    openaiRoute = () => new Response(QUOTA, { status: 429 });
    const err = await structured().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAiQuotaError);
    expect((err as InstanceType<typeof OpenAiQuotaError>).detail).toMatch(/^You have no credits remaining\./);
    expect((err as Error).message).toMatch(/insufficient_quota/);
    expect(openaiCalls()).toHaveLength(1);
    expect(claudeCalls()).toHaveLength(0);
  });

  it("still retries an ordinary rate-limit 429", async () => {
    prefs.aiFallbackPolicy = "off";
    let n = 0;
    openaiRoute = () => (++n < 2 ? new Response('{"error":{"type":"requests","code":"rate_limit_exceeded","message":"Rate limit reached"}}', { status: 429 }) : json(OPENAI_OK));
    expect(await structured()).toEqual({ ok: "openai" });
    expect(openaiCalls()).toHaveLength(2);
  });

  it("'any' also covers a missing OpenAI key", async () => {
    prefs.aiFallbackPolicy = "any";
    keys.openai = undefined;
    expect(await structured()).toEqual({ ok: "claude" });
    expect(openaiCalls()).toHaveLength(0);
  });

  it("'always' makes Claude the primary provider", async () => {
    prefs.aiFallbackPolicy = "always";
    expect(await structured()).toEqual({ ok: "claude" });
    expect(openaiCalls()).toHaveLength(0);
  });

  it("uses the main-tier Claude model for the cover-letter tier", async () => {
    prefs.claudeMainModel = "claude-sonnet-5-5";
    claudeRoute = () => claudeSse("Dear hiring team");
    const deltas: string[] = [];
    expect(await requestTextStream("sys", "user", (d) => deltas.push(d))).toBe("Dear hiring team");
    expect(deltas.join("")).toBe("Dear hiring team");
    const { body, headers } = claudeCalls()[0];
    expect(body.model).toBe("claude-sonnet-5-5");
    expect(body.stream).toBe(true);
    // Opus/Sonnet/Fable get the server-side refusal fallback; the beta goes in the header.
    expect(body.fallbacks).toBe("default");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    prefs.claudeMainModel = "";
  });

  it("doesn't fall back once a stream has shown text", async () => {
    prefs.aiFallbackPolicy = "any";
    const frames =
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Dear" })}\n\n` +
      `data: ${JSON.stringify({ type: "response.failed", response: { error: { message: "boom" } } })}\n\n`;
    openaiRoute = () => new Response(frames, { headers: { "content-type": "text/event-stream" } });
    await expect(requestTextStream("sys", "user", () => {})).rejects.toThrow(/boom/);
    expect(claudeCalls()).toHaveLength(0);
  });

  it("emulates the Decisions API on Claude", async () => {
    claudeRoute = () => json(claudeMessage(JSON.stringify({ cb0_check: { probability: 0.9 }, cv: { choice: "b", confidence: 0.7 } })));
    const answers = await requestDecisions({
      input: "Checkbox: I agree to the privacy policy",
      questions: [
        { type: "predicate", name: "cb0_check", instructions: "Should it be checked?" },
        { type: "choice", name: "cv", instructions: "Which CV?", choices: [{ value: "a" }, { value: "b" }] },
      ],
    });
    expect(answers.get("cb0_check")).toEqual({ type: "predicate", name: "cb0_check", probability: 0.9 });
    expect(answers.get("cv")).toMatchObject({ type: "choice", choice: "b", confidence: 0.7 });
    expect(openaiCalls()[0].url).toBe("https://api.openai.com/v1/decisions");
  });
});

describe("toClaudeSchema", () => {
  it("turns nullable type lists into anyOf and drops unsupported constraints", () => {
    expect(
      toClaudeSchema({
        type: "object",
        properties: {
          salary: { type: ["string", "null"], description: "Salary", maxLength: 80 },
          level: { type: ["string", "null"], enum: ["A1", "B2", null] },
          tags: { type: "array", items: { type: "string" }, maxItems: 5 },
          score: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["salary", "level", "tags", "score"],
        additionalProperties: false,
      }),
    ).toEqual({
      type: "object",
      properties: {
        salary: { anyOf: [{ type: "string", description: "Salary" }, { type: "null" }] },
        level: { enum: ["A1", "B2", null] },
        tags: { type: "array", items: { type: "string" } },
        score: { type: "number" },
      },
      required: ["salary", "level", "tags", "score"],
      additionalProperties: false,
    });
  });
});
