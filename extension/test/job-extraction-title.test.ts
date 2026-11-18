import { beforeEach, describe, expect, it } from "vitest";
import { extractJob } from "@/features/job-extraction/extractor";

/** A careers page with no JSON-LD: brand + tagline in `og:site_name`, heading + place + site in the title. */
function page({ title, siteName, h1 }: { title: string; siteName?: string; h1: string }): void {
  document.head.innerHTML = `
    <meta property="og:title" content="${title}">
    ${siteName ? `<meta property="og:site_name" content="${siteName}">` : ""}`;
  document.body.innerHTML = `<main><h1>${h1}</h1><p>${"We build payment services. ".repeat(20)}</p></main>`;
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

describe("title and site name on a plain careers page", () => {
  it("keeps the brand, drops the tagline, and reads the place off the title", () => {
    page({
      title: "Backend Engineer (Golang) - Transfers Europe in Berlin, Germany | Careers at SumUp",
      siteName: "SumUp - A Better Way to Get Paid",
      h1: "Backend Engineer (Golang) - Transfers Europe",
    });
    const job = extractJob(document, "https://sumup.com/careers/positions/8789067002");
    expect(job.company).toBe("SumUp");
    expect(job.position).toBe("Backend Engineer - Transfers Europe");
    expect(job.location).toBe("Berlin, Germany");
  });

  it("picks the segment the host spells when the title names no company", () => {
    page({ title: "Data Engineer", siteName: "The best way to ship | Acmecorp", h1: "Data Engineer" });
    expect(extractJob(document, "https://jobs.acmecorp.de/1").company).toBe("Acmecorp");
  });

  it("leaves a plain site name and a title without the heading alone", () => {
    page({ title: "Frontend Developer at Foo", siteName: "Foo GmbH", h1: "Join us" });
    const job = extractJob(document, "https://foo.de/jobs/2");
    expect(job.company).toBe("Foo GmbH");
    expect(job.position).toBe("Frontend Developer at Foo");
    expect(job.location).toBe("");
  });

  it("falls back to the title's \"Careers at X\" when there is no site name", () => {
    page({ title: "QA Engineer | Careers at Bar", h1: "QA Engineer" });
    expect(extractJob(document, "https://bar.io/x").company).toBe("Bar");
  });
});
