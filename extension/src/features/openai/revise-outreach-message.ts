import type { Job } from "@/types/job";
import { getOutreachModel, requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";
import type { OutreachMessageResult } from "./outreach-message";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You are editing an existing outreach message (an email or LinkedIn note
to a recruiter/hiring contact) on the applicant's instructions.

Ground rules:
- Apply ONLY the change the applicant asked for. Do not rewrite parts of the message the
  instruction didn't touch.
- Never invent experience, technologies, companies, education, or achievements that aren't
  already in the draft or the job context provided.
- Keep the same language the draft is currently written in unless the instruction explicitly
  asks to change it.
- If the draft's "subject" is null, keep it null (it's a LinkedIn note). Otherwise keep a
  specific subject line, changing it only if the instruction (or the edit) requires it.
- Don't introduce AI-slop while editing, and clean it from any sentence you touch.

${HOUSE_STYLE_RULES}`;

/** Outreach-message "Improve" pass: free-text instructions drive a targeted edit of the current draft, same shape as `reviseCoverLetter`. */
export async function reviseOutreachMessage(
  draft: OutreachMessageResult,
  instructions: string,
  job: Job,
): Promise<OutreachMessageResult> {
  const userPrompt = JSON.stringify({ draft, instructions, job }, null, 2);

  const result = await requestStructured<OutreachMessageResult>({
    schemaName: "outreach_message_revision",
    schema: SCHEMA,
    model: await getOutreachModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as OutreachMessageResult,
  });

  return { subject: draft.subject === null ? null : result.subject, body: stripEmDashes(result.body) };
}
