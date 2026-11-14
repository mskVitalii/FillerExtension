import { afterEach, describe, expect, it } from "vitest";
import { extractJob } from "@/features/job-extraction/extractor";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";

/**
 * Trimmed from a real LinkedIn search-results page (`/jobs/search-results/?currentJobId=…`):
 * obfuscated class names dropped, only the hooks LinkedIn itself ships kept: the header's
 * `[role="search"]` box, the `SemanticJobDetails` screen, `aria-label="Company, …"`, the
 * `/jobs/view/<id>/` title link, the "About the job" `expandable-text-box`, and the ads
 * around it ("Activate Premium for €0") that must not leak into the job.
 */
const PAGE = `<!doctype html><html lang="en"><head>
  <title>Founding AI Engineer (Renewable Energy) | ELANI One | LinkedIn</title>
</head><body>
  <header>
    <div role="search">
      <div><input data-testid="typeahead-input" autocomplete="off" placeholder="Describe the job you want" aria-autocomplete="list"></div>
    </div>
  </header>
  <main>
    <div componentkey="SearchResultsMainContent">
      <a href="https://www.linkedin.com/jobs/view/111/"><p>Some Other Job From The List</p></a>
    </div>
    <div data-sdui-screen="com.linkedin.sdui.flagshipnav.jobs.SemanticJobDetails">
      <div>
        <div aria-label="Company, ELANI One."><a href="https://www.linkedin.com/company/elani-one/life/"><svg aria-label="Company logo for, ELANI One."></svg></a></div>
        <div><div><p><a href="https://www.linkedin.com/jobs/view/4484453144/?trackingId=abc">Founding AI Engineer (Renewable Energy)</a></p></div></div>
        <p><span>Munich, Bavaria, Germany</span><span> · </span><span>2 weeks ago</span><span> · </span><span>Over 100 applicants</span></p>
        <p><span>Promoted by hirer · Actively reviewing applicants</span></p>
        <div><a><span>Hybrid</span></a><a><span>Full-time</span></a></div>
      </div>
      <div><p>See how you compare to over 100 other applicants</p><p>Activate Premium for €0</p></div>
      <div componentkey="JobDetails_AboutTheJob_4484453144">
        <h2>About the job</h2>
        <div data-testid="expandable-text-box">
          <p><strong>About us</strong></p>
          <p>ELANI One is the agentic operating system for renewable energy. We support developers, IPPs and utilities in developing more projects, faster and at lower costs.</p>
          <p><strong>What you'll do</strong></p>
          <ul><li>Build our agentic platform end to end, from data model and APIs to agent workflows</li>
            <li>Turn customer needs into a working product, together with the founder</li></ul>
          <p><strong>What you bring</strong></p>
          <ul><li>5+ years of software engineering experience with TypeScript and Python</li>
            <li>Hands-on experience bringing LLMs and AI agents into production</li></ul>
          <p><strong>How to apply</strong></p>
          <p>Send your CV to careers@elani.one, including your earliest start date and salary expectations.</p>
          <button data-testid="expandable-text-button">… more</button>
        </div>
      </div>
    </div>
  </main>
</body></html>`;

const URL = "https://www.linkedin.com/jobs/search-results/?currentJobId=4484453144&keywords=ai%20engineer";

function linkedInDoc(html = PAGE): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("LinkedIn jobs search-results extraction", () => {
  it("reads the selected job from the details pane, not the result list", () => {
    const job = extractJob(linkedInDoc(), URL);
    expect(job.position).toBe("Founding AI Engineer");
    expect(job.company).toBe("ELANI One");
    expect(job.location).toBe("Munich, Bavaria, Germany (Hybrid)");
    expect(job.url).toBe("https://www.linkedin.com/jobs/view/4484453144/");
  });

  it("takes the description from About the job, keeping its structure and dropping the … more button", () => {
    const job = extractJob(linkedInDoc(), URL);
    expect(job.description.startsWith("About us\nELANI One is the agentic operating system")).toBe(true);
    expect(job.description).toContain("\n• Build our agentic platform end to end");
    expect(job.description).not.toContain("… more");
    expect(job.description).not.toContain("Premium");
  });

  it("reads lists, stack and contact from the posting only — no Premium-ad salary, no company-page contact", () => {
    const job = extractJob(linkedInDoc(), URL);
    expect(job.responsibilities).toHaveLength(2);
    expect(job.requirements).toEqual([
      "5+ years of software engineering experience with TypeScript and Python",
      "Hands-on experience bringing LLMs and AI agents into production",
    ]);
    expect(job.techStack).toEqual(expect.arrayContaining(["TypeScript", "Python"]));
    expect(job.salary).toBeNull();
    expect(job.contact).toBe("careers@elani.one");
  });

  it("falls back to the <title> when the details pane's markup isn't there", () => {
    const job = extractJob(linkedInDoc(PAGE.replace(/data-sdui-screen="[^"]*"/, "")), URL);
    expect(job.position).toBe("Founding AI Engineer");
    expect(job.company).toBe("ELANI One");
  });

  it("leaves non-jobs LinkedIn pages to the generic pass", () => {
    const job = extractJob(linkedInDoc(), "https://www.linkedin.com/feed/");
    expect(job.company).toBe("");
  });
});

describe("custom-question detection skips a site's search box", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not treat LinkedIn's 'Describe the job you want' search as an application question", async () => {
    document.body.innerHTML = new DOMParser().parseFromString(PAGE, "text/html").body.innerHTML;
    document.body.insertAdjacentHTML(
      "beforeend",
      `<form><label for="why">Why do you want to work here?</label><textarea id="why"></textarea></form>`,
    );
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    expect(questions).not.toContain("Describe the job you want");
    expect(questions).toContain("Why do you want to work here?");
  });

  it("also skips <input type=search> and fields inside navigation", async () => {
    document.body.innerHTML = `
      <input type="search" placeholder="What job are you looking for?">
      <nav><input placeholder="Which city do you want to work in?"></nav>`;
    expect(await detectCustomQuestions()).toEqual([]);
  });
});
