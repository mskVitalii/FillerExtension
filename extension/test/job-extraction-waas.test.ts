import { describe, expect, it } from "vitest";
import { extractJob, isExtractionSufficient } from "@/features/job-extraction/extractor";

/**
 * Real page shape from https://www.workatastartup.com/jobs/69071 — no
 * JSON-LD, role+company fused into `og:title` with a marketplace suffix,
 * `og:site_name` = the marketplace, and the actual job description as
 * Markdown in `<meta property="description">`.
 */
const DESCRIPTION_MD = `## About us

Software engineering is being fundamentally transformed by AI, and we're building the tools to lead that shift. Aviator is creating the **engineering productivity supertools** that will define how the best teams build software in the AI era.

Backed by Y Combinator (S21), we're a small, focused team in San Francisco.

## What you will do

* Work closely with the users to understand their development needs and use cases to guide our roadmap.
* Build prototypes all the way to final products. Solve complex issues for our users.
* Collaborate with our founders to gather requirements through detailed technical discussions.

## We’re looking for someone who has:

* Shipped full-stack products before - whether it was in your day job or projects outside of work.
* Experience working in low-structure environment, comfortable working with unknowns.
* Strong communication skills.

## Benefits

* Health/Dental/Vision
* Unlimited vacation policy`;

function waasDoc(overrides: { title?: string; description?: string; body?: string } = {}): Document {
  const title = overrides.title ?? "Software engineer, Fullstack at Aviator";
  const description = overrides.description ?? DESCRIPTION_MD;
  const body =
    overrides.body ??
    `<main>
       <h1>Software engineer, Fullstack</h1>
       <a href="/companies/aviator">Aviator</a>
       <div class="job-details">
         <span><i class="fa fa-map-marker"></i> San Francisco, CA, US</span>
         <span><i class="fa fa-clock-o"></i> Full-time</span>
       </div>
     </main>`;
  const html = `<!doctype html><html lang="en"><head>
      <title>${title} | Y Combinator's Work at a Startup</title>
      <meta property="title" content="${title.replace(/"/g, "&quot;")}">
      <meta property="og:title" content="${title.replace(/"/g, "&quot;")} | Y Combinator's Work at a Startup">
      <meta property="og:site_name" content="Y Combinator's Work at a Startup">
      <meta property="og:url" content="https://www.workatastartup.com/jobs/69071">
      <meta property="description" content="${description.replace(/"/g, "&quot;")}">
      <meta property="og:description" content="${description.replace(/"/g, "&quot;")}">
    </head><body>${body}</body></html>`;
  return new DOMParser().parseFromString(html, "text/html");
}

const URL = "https://www.workatastartup.com/jobs/69071";

describe("Work at a Startup (workatastartup.com) extraction", () => {
  it("splits '{role} at {company}' and drops the marketplace suffix", () => {
    const job = extractJob(waasDoc(), URL);
    expect(job.position).toBe("Software engineer, Fullstack");
    expect(job.company).toBe("Aviator");
  });

  it("does not leave the marketplace name as the company", () => {
    expect(extractJob(waasDoc(), URL).company).not.toMatch(/Y Combinator/i);
  });

  it("takes the description from the Markdown meta tag, not the page chrome", () => {
    const job = extractJob(waasDoc(), URL);
    expect(job.description).toContain("Software engineering is being fundamentally transformed by AI");
    expect(job.description).not.toContain("##");
    expect(isExtractionSufficient(job)).toBe(true);
  });

  it("parses the 'What you will do' and 'looking for' bullets into responsibilities/requirements", () => {
    const job = extractJob(waasDoc(), URL);
    expect(job.responsibilities).toContain("Build prototypes all the way to final products. Solve complex issues for our users.");
    expect(job.requirements.some((r) => r.startsWith("Shipped full-stack products before"))).toBe(true);
    // "Benefits" bullets must not bleed into either list.
    expect(job.requirements).not.toContain("Unlimited vacation policy");
    expect(job.responsibilities).not.toContain("Health/Dental/Vision");
  });

  it("reads the location from the header pin row", () => {
    expect(extractJob(waasDoc(), URL).location).toBe("San Francisco, CA, US");
  });

  it("recognises the site from meta signals even when the URL isn't a workatastartup.com link", () => {
    const job = extractJob(waasDoc(), "https://example.com/redirect?to=job");
    expect(job.company).toBe("Aviator");
  });

  it("falls back to the company link in the DOM when the title has no ' at '", () => {
    const job = extractJob(waasDoc({ title: "Founding Engineer" }), URL);
    expect(job.position).toBe("Founding Engineer");
    expect(job.company).toBe("Aviator");
  });

  it("leaves non-WaaS pages to the generic pass", () => {
    const html = `<!doctype html><html><head><title>Backend Engineer</title>
        <meta property="og:title" content="Backend Engineer">
        <meta property="og:site_name" content="Greenhouse">
      </head><body><main><p>${"We are hiring a backend engineer. ".repeat(20)}</p></main></body></html>`;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const job = extractJob(doc, "https://boards.greenhouse.io/acme/jobs/123");
    expect(job.company).toBe("Greenhouse");
    expect(job.position).toBe("Backend Engineer");
  });
});
