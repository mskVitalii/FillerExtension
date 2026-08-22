import type { Job } from "@/types/job";
import { requestStructured } from "@/features/openai/client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "position",
    "location",
    "description",
    "requirements",
    "responsibilities",
    "salary",
    "techStack",
    "contact",
  ],
  properties: {
    company: { type: "string" },
    position: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    requirements: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    salary: { type: ["string", "null"] },
    techStack: { type: "array", items: { type: "string" } },
    contact: { type: ["string", "null"] },
  },
} as const;

/**
 * Only called when DOM/JSON-LD extraction is insufficient (spec section 10).
 * Sends visible text — never the raw page HTML — to the user's OpenAI key.
 */
export async function extractJobWithAi(visibleText: string, url: string): Promise<Job> {
  const result = await requestStructured<Omit<Job, "url">>({
    schemaName: "job_extraction",
    schema: SCHEMA,
    systemPrompt:
      "Extract structured job posting fields from the visible page text below. " +
      "Only use information present in the text; leave fields empty/null if unknown.",
    userPrompt: visibleText.slice(0, 12000),
    parse: (raw) => JSON.parse(raw) as Omit<Job, "url">,
  });
  return { ...result, url };
}
