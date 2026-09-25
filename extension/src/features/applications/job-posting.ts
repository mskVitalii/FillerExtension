import type { Job } from "@/types/job";

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}\n` : "";
}

function bullets(items: string[]): string {
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `- ${item}`)
    .join("\n");
}

/** The posting as a standalone Markdown document — what's kept in Drive next to the cover letter and adapted CV. */
export function formatJobPosting(job: Job): string {
  const meta = [
    ["Company", job.company],
    ["Location", job.location],
    ["Salary", job.salary],
    ["Contact", job.contact],
    ["URL", job.url],
  ]
    .filter(([, value]) => value?.trim())
    .map(([label, value]) => `- **${label}:** ${value!.trim()}`)
    .join("\n");

  return [
    `# ${job.position.trim() || "Job posting"}\n`,
    meta && `${meta}\n`,
    section("Description", job.description),
    section("Responsibilities", bullets(job.responsibilities)),
    section("Requirements", bullets(job.requirements)),
    section("Tech stack", job.techStack.filter(Boolean).join(", ")),
  ]
    .filter(Boolean)
    .join("\n");
}

export function jobPostingFileName(job: Pick<Job, "company" | "position">): string {
  return `Job posting - ${job.company || job.position || "application"}.md`;
}
