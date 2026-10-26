/**
 * Response schemas shared by more than one `requestStructured` call, so a
 * generation and its revision pass can't drift apart in what they return.
 */

/** A single block of prose — cover-letter polish, revision and translation. */
export const CONTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
} as const;

export interface ContentResult {
  content: string;
}

/** An outreach message; `subject` is null for a LinkedIn note. Matches `OutreachMessageResult`. */
export const OUTREACH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
  },
} as const;
