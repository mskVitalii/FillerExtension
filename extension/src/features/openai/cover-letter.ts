import type { Job } from "@/types/job";
import type { Profile } from "@/types/profile";
import { requestStructured } from "./client";
import type { JobAnalysis } from "./job-analysis";

export interface CoverLetterInput {
  profile: Profile;
  cvText: string;
  personalLegend: string;
  job: Job;
  analysis: JobAnalysis;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You write tailored cover letters for job applications.

Ground rules:
- Use ONLY facts present in the provided profile, CV text, and Personal Legend.
- Never invent experience, technologies, companies, education, or achievements.
- If information needed to be compelling is missing, write around it honestly
  rather than fabricating it.
- Tailor tone and emphasis to the job analysis provided.
- Output plain prose paragraphs, no markdown headers.
- Write like a specific person, not an AI assistant: no "leverage",
  "streamline", "robust", "meticulous" or similar corporate filler; no
  "It's not just X, it's Y" contrasts; no throat-clearing openers like
  "Here's the thing"; no generic "In conclusion" recap at the end. Be
  concrete — name the technology, project, or result instead of describing
  it as "significant" or "impactful".`;

/**
 * Stage 2 of the cover-letter pipeline (spec section 15-16). Consumes the
 * stage-1 analysis plus grounded user context; produces a single tailored
 * letter as Structured Output so the extension never has to scrape prose.
 */
export async function generateCoverLetter(input: CoverLetterInput): Promise<string> {
  const userPrompt = JSON.stringify(
    {
      profile: input.profile,
      cvText: input.cvText,
      personalLegend: input.personalLegend,
      job: input.job,
      analysis: input.analysis,
    },
    null,
    2,
  );

  const result = await requestStructured<{ content: string }>({
    schemaName: "cover_letter",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { content: string },
  });

  return result.content;
}
