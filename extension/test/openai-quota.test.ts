import { describe, expect, it } from "vitest";
import { OpenAiError, OpenAiQuotaError, isQuotaExhaustedText, openAiErrorDetail, openAiHttpError, quotaErrorDetail } from "@/features/openai/errors";

const BODY = '{\n  "error": {\n    "code": "credit_balance_exhausted",\n    "message": "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.",\n    "param": null,\n    "type": "insufficient_quota"\n  }\n}';
const DETAIL = "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.";

describe("OpenAI out-of-credits classification", () => {
  it("recognises insufficient_quota and credit_balance_exhausted, not a rate limit", () => {
    expect(isQuotaExhaustedText(BODY)).toBe(true);
    expect(isQuotaExhaustedText('{"error":{"type":"insufficient_quota"}}')).toBe(true);
    expect(isQuotaExhaustedText('{"error":{"code":"credit_balance_exhausted"}}')).toBe(true);
    expect(isQuotaExhaustedText('{"error":{"code":"rate_limit_exceeded","type":"requests"}}')).toBe(false);
    expect(isQuotaExhaustedText("")).toBe(false);
    expect(isQuotaExhaustedText(undefined)).toBe(false);
  });

  it("turns a quota 429 into OpenAiQuotaError and anything else into a plain OpenAiError", () => {
    const quota = openAiHttpError("OpenAI request", 429, BODY);
    expect(quota).toBeInstanceOf(OpenAiQuotaError);
    expect(quota.status).toBe(429);
    expect((quota as OpenAiQuotaError).detail).toBe(DETAIL);

    const rate = openAiHttpError("OpenAI request", 429, '{"error":{"code":"rate_limit_exceeded"}}');
    expect(rate).not.toBeInstanceOf(OpenAiQuotaError);
    expect(rate).toBeInstanceOf(OpenAiError);
    expect(rate.message).toMatch(/^OpenAI request failed \(429\): /);

    // The markers in a non-429 body don't make it a quota error.
    expect(openAiHttpError("OpenAI request", 400, BODY)).not.toBeInstanceOf(OpenAiQuotaError);
  });

  it("gets OpenAI's own message back from the error text the Side Panel receives", () => {
    expect(quotaErrorDetail(new OpenAiQuotaError(DETAIL).message)).toBe(DETAIL);
    // An older raw form, or one embedded in a longer status line.
    expect(quotaErrorDetail(`OpenAI request failed (429): ${BODY}`)).toBe(DETAIL);
    expect(isQuotaExhaustedText(`Answering questions failed: ${new OpenAiQuotaError(DETAIL).message}`)).toBe(true);
  });

  it("reads the message from a body cut off mid-JSON", () => {
    expect(openAiErrorDetail(BODY.slice(0, BODY.indexOf('"param"')))).toBe(DETAIL);
    expect(openAiErrorDetail('{"error":{"message":"No \\"credits\\" left","type":"insufficient_quota"')).toBe('No "credits" left');
    expect(openAiErrorDetail("plain text")).toBe("plain text");
  });
});
