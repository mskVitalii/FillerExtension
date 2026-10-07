import type { Job } from "@/types/job";
import type { Profile } from "@/types/profile";
import { getOutreachModel, requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";

export interface OutreachMessageInput {
  profile: Profile;
  cvText: string;
  personalLegend: string;
  /** Applicant-authored tone/length instructions for outreach messages specifically (Settings) — distinct from cover-letter Generation Rules. */
  outreachRules: string;
  job: Job;
  /** The recruiter/hiring contact found on the posting — an email address or a LinkedIn profile/company URL (`Job.contact`). */
  contact: string;
  postingLanguage?: string;
}

export interface OutreachMessageResult {
  /** Null when `contact` is a LinkedIn URL rather than an email — a LinkedIn message has no subject line. */
  subject: string | null;
  body: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["subject", "body"],
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You write a short outreach message an applicant sends to a named
recruiter/hiring contact BEFORE or alongside applying, to start a conversation about a specific
job posting — not a cover letter, and not addressed to "the hiring team".

The user message holds the applicant's data as JSON ("contact" is the email address or LinkedIn
URL found on the posting), and may end with an "Applicant's rules" section written by the
applicant themselves.

Priority, highest first. When two of these conflict, the higher one wins:
1. Facts. Use ONLY facts present in the provided profile, CV text, and Personal Legend. Never
   invent experience, technologies, companies, education, or achievements.
2. The applicant's rules. Follow every instruction there on tone, length, structure, language,
   and what to include or avoid, including where it departs from the defaults below.
3. Language. If "postingLanguage" is given, write the entire message in that language, using
   the salutation and register native speakers of it would expect.
4. Channel. If "contact" looks like an email address, write a short email: "subject" is a
   specific, non-generic subject line (name the role and company), "body" opens with a greeting
   and closes with a signature using the applicant's name. If "contact" is a LinkedIn URL,
   write a LinkedIn connection/message note instead: "subject" is null, "body" has no email
   greeting/signature and stays under LinkedIn's informal register.
5. The house style below. Its "no exceptions" means no exceptions of your own; an explicit
   applicant rule still overrides it.

Defaults (apply unless the applicant's rules say otherwise): under 120 words, state who the
applicant is and the one or two things that make them a fit for THIS role, and end with a clear,
low-pressure ask (a quick chat, or just flagging interest before applying). Never sound like a
mass-sent template.

${HOUSE_STYLE_RULES}`;

/**
 * "Generate outreach message" feature: drafts the email/LinkedIn note an
 * applicant sends to a job posting's recruiter/hiring contact to start the
 * conversation, grounded in the same applicant data as the cover letter.
 * Non-streamed (`requestStructured`) — short enough that there's no benefit
 * to showing it token-by-token, and the subject/body split needs a real
 * JSON shape rather than parsing plain text.
 */
export async function generateOutreachMessage(input: OutreachMessageInput): Promise<OutreachMessageResult> {
  const data = JSON.stringify(
    {
      profile: input.profile,
      cvText: input.cvText,
      personalLegend: input.personalLegend,
      job: input.job,
      contact: input.contact,
      postingLanguage: input.postingLanguage || undefined,
    },
    null,
    2,
  );
  const userPrompt = data + outreachRulesSection(input.outreachRules);

  const result = await requestStructured<OutreachMessageResult>({
    schemaName: "outreach_message",
    schema: SCHEMA,
    model: await getOutreachModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as OutreachMessageResult,
  });

  return { subject: result.subject, body: stripEmDashes(result.body) };
}

/** The applicant's outreach rules as the closing section of a user prompt, or "" when they wrote none. */
function outreachRulesSection(rules: string): string {
  const trimmed = rules.trim();
  if (!trimmed) return "";
  return `\n\n## Applicant's rules (highest priority after facts)\n\n${trimmed}\n`;
}
