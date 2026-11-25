import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeJobLink,
  collectJobLinks,
  dedupeJobLinks,
  findJobCards,
  jobIdFromHref,
  linkedInPageKind,
  readCard,
} from "@/features/linkedin-collector/links";
import { bootLinkedInCollector, currentJob, jobsForPage } from "@/features/linkedin-collector/collector";
import { mergeCollected, sanitizeIncoming } from "@/features/linkedin-collector/store";
import { isJobBoardUrl, rankEmployerHits, scoreEmployerHit } from "@/features/linkedin-collector/employer-posting";
import { applyViaAgent, isLinkedInUrl } from "@/features/agent-bridge/client";
import { cleanEmployerUrl, employerApplyUrl, findApplyLink, unwrapLinkedInRedirect } from "@/features/linkedin-collector/apply-link";
import { EMPTY_JOB } from "@/types/job";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The synthetic LinkedIn search page — also the manual test page (test-pages/, repo root). */
const FIXTURE = path.resolve(here, "../../test-pages/linkedin-jobs-test.html");
const SEARCH_HREF = "https://www.linkedin.com/jobs/search/?currentJobId=4100000003&keywords=engineer";

function loadLinkedInFixture(): void {
  const parsed = new DOMParser().parseFromString(readFileSync(FIXTURE, "utf-8"), "text/html");
  // Without its <script>: the manual page's chrome.runtime stub isn't part of the markup under test.
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  document.body.innerHTML = parsed.body.innerHTML;
  document.title = parsed.title;
}

const ids = (links: { id: string }[]) => links.map((link) => link.id);

describe("LinkedIn job links", () => {
  beforeEach(loadLinkedInFixture);

  it("collects every job card variant once, as canonical /jobs/view/<id>/ links in page order", () => {
    const links = collectJobLinks(document);
    expect(ids(links)).toEqual(["4100000001", "4100000002", "4100000003", "4100000004", "4100000005", "4100000006"]);
    for (const link of links) expect(link.url).toBe(`https://www.linkedin.com/jobs/view/${link.id}/`);
  });

  it("reads title, company and location from classic, server-driven, guest and non-Latin cards", () => {
    const byId = Object.fromEntries(collectJobLinks(document).map((link) => [link.id, link]));
    expect(byId["4100000001"]).toMatchObject({ title: "Staff Backend Engineer", company: "Globex GmbH", location: "Berlin, Germany (Hybrid)" });
    expect(byId["4100000003"]).toMatchObject({ title: "Senior Go Engineer", company: "Acme Robotics", location: "Munich, Bavaria, Germany (Remote)" });
    expect(byId["4100000004"]).toMatchObject({ title: "Platform Engineer (m/w/d)", company: "Initech SE", location: "Hamburg, Germany" });
    expect(byId["4100000005"]).toMatchObject({ title: "Frontend Developer", company: "Umbrella Corp", location: "Köln, Nordrhein-Westfalen, Deutschland" });
    expect(byId["4100000006"]).toMatchObject({ title: "Разработчик Python", company: "Рога и Копыта", location: "Москва" });
  });

  it("keeps a virtualized (empty) card as an id-only link", () => {
    const occluded = collectJobLinks(document).find((link) => link.id === "4100000002");
    expect(occluded).toEqual({ id: "4100000002", url: "https://www.linkedin.com/jobs/view/4100000002/", title: "", company: "", location: "" });
  });

  it("ignores the details pane, company/profile/search links, other hosts and non-numeric ids", () => {
    const found = ids(findJobCards(document));
    expect(found).not.toContain("4100000077");
    expect(found).not.toContain("4100009999");
    expect(new Set(found).size).toBeLessThanOrEqual(found.length);
    // The nested classic carrier (li > div[data-job-id]) is one card, the outer one.
    const classic = findJobCards(document).filter((card) => card.id === "4100000001");
    expect(classic[0].card.tagName).toBe("LI");
  });

  it("Add all takes only rendered, off-LinkedIn cards, with the selected job's pane details", () => {
    const scan = jobsForPage(document, SEARCH_HREF);
    // Card 1 is Easy Apply (Filler never applies on LinkedIn), card 2 isn't rendered yet.
    expect(ids(scan.jobs)).toEqual(["4100000003", "4100000004", "4100000005", "4100000006"]);
    expect(scan).toMatchObject({ easyApply: 1, notLoaded: 1 });
    expect(scan.jobs.find((job) => job.id === "4100000003")).toMatchObject({ title: "Senior Go Engineer", company: "Acme Robotics" });
  });

  it("reads the posting of a /jobs/view/ page", () => {
    document.body.innerHTML = "<main><h1>Senior Go Engineer</h1></main>";
    document.title = "Senior Go Engineer | Acme Robotics | LinkedIn";
    expect(currentJob(document, "https://www.linkedin.com/jobs/view/4100000009/?refId=x")).toEqual({
      id: "4100000009",
      url: "https://www.linkedin.com/jobs/view/4100000009/",
      title: "Senior Go Engineer",
      company: "Acme Robotics",
      location: "",
    });
  });

  it("finds cards whose id is only in a tracking attribute (server-driven list)", () => {
    document.body.innerHTML = `<main><div>239 results</div><ul>
      ${[1, 2, 3]
        .map(
          (n) => `<li><div componentkey="job-card-component-ref-410000010${n}" data-view-tracking="x">
            <a href="https://www.linkedin.com/jobs/search-results/?keywords=go"><p>Engineer ${n}</p></a><p>Company ${n}</p><p>Berlin</p>
          </div></li>`,
        )
        .join("")}
    </ul></main>`;
    const cards = findJobCards(document);
    expect(ids(cards)).toEqual(["4100000101", "4100000102", "4100000103"]);
    expect(cards.every(({ card }) => card.tagName === "LI")).toBe(true);
    expect(readCard(cards[1].card, "4100000102").title).toBe("Engineer 2");
  });

  it("never takes the whole list as one card when only one card carries an id", () => {
    document.body.innerHTML = `<ul>
      <li><a href="/jobs/view/4100000201/">One</a><p>Acme</p></li>
      <li><a href="/jobs/search-results/">Two</a><p>Initech</p></li>
      <li><a href="/jobs/search-results/">Three</a><p>Globex</p></li>
    </ul>`;
    const cards = findJobCards(document);
    expect(ids(cards)).toEqual(["4100000201"]);
    expect(cards[0].card.tagName).toBe("LI");
  });
});

describe("job ids and page kinds", () => {
  it.each([
    ["/jobs/view/4100000001/?refId=abc&trackingId=t", "4100000001"],
    ["https://de.linkedin.com/jobs/view/platform-engineer-at-initech-4100000004?refId=r4", "4100000004"],
    ["https://www.linkedin.com/jobs/search-results/?currentJobId=4100000003&eBP=x", "4100000003"],
    ["https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4100000008", "4100000008"],
    ["https://www.linkedin.com/comm/jobs/view/4100000010", "4100000010"],
    ["https://www.linkedin.com/company/acme/", ""],
    ["https://www.linkedin.com/feed/?currentJobId=4100000003", ""],
    ["https://evil.example/jobs/view/4100000001/", ""],
    ["https://linkedin.com.evil.example/jobs/view/4100000001/", ""],
    ["javascript:alert(1)", ""],
    [null, ""],
  ])("%s → %s", (href, id) => {
    expect(jobIdFromHref(href)).toBe(id);
  });

  it("canonicalizes an id or a link, and nothing else", () => {
    expect(canonicalizeJobLink("4100000001")).toBe("https://www.linkedin.com/jobs/view/4100000001/");
    expect(canonicalizeJobLink("https://www.linkedin.com/jobs/view/4100000001/?refId=1")).toBe("https://www.linkedin.com/jobs/view/4100000001/");
    expect(canonicalizeJobLink("https://example.com/")).toBe("");
  });

  it("tells list pages from view pages, and ignores the rest of LinkedIn", () => {
    expect(linkedInPageKind("https://www.linkedin.com/jobs/search/?keywords=go")).toBe("list");
    expect(linkedInPageKind("https://www.linkedin.com/jobs/search-results/?currentJobId=1")).toBe("list");
    expect(linkedInPageKind("https://www.linkedin.com/jobs/collections/recommended/")).toBe("list");
    expect(linkedInPageKind("https://www.linkedin.com/jobs/view/4100000001/")).toBe("view");
    expect(linkedInPageKind("https://www.linkedin.com/feed/")).toBeNull();
    expect(linkedInPageKind("https://www.linkedin.com/jobs/")).toBeNull();
    expect(linkedInPageKind("http://www.linkedin.com/jobs/search/")).toBeNull();
    expect(linkedInPageKind("https://example.com/jobs/search/")).toBeNull();
  });

  it("dedupes by id, filling an id-only entry from a later rendered one", () => {
    const merged = dedupeJobLinks([
      { id: "1234567", url: "u", title: "", company: "", location: "" },
      { id: "1234567", url: "u", title: "Engineer", company: "Acme", location: "Berlin" },
      { id: "7654321", url: "v", title: "Other", company: "", location: "" },
    ]);
    expect(merged).toEqual([
      { id: "1234567", url: "u", title: "Engineer", company: "Acme", location: "Berlin" },
      { id: "7654321", url: "v", title: "Other", company: "", location: "" },
    ]);
  });
});

describe("collected-jobs store", () => {
  it("re-validates what a page sent: ids only, URL rebuilt, text trimmed", () => {
    const clean = sanitizeIncoming([
      { id: "4100000001", url: "javascript:alert(1)", title: "  Staff\n Engineer ", company: "Globex", location: "Berlin" },
      { id: "not-a-number", url: "https://www.linkedin.com/jobs/view/4100000002/", title: "From the URL" },
      { id: "x", url: "https://evil.example/jobs/view/4100000003/" },
      { id: "4100000001", title: "dup" },
      "garbage",
      null,
    ]);
    expect(clean).toEqual([
      { id: "4100000001", url: "https://www.linkedin.com/jobs/view/4100000001/", title: "Staff Engineer", company: "Globex", location: "Berlin" },
      { id: "4100000002", url: "https://www.linkedin.com/jobs/view/4100000002/", title: "From the URL", company: "", location: "" },
    ]);
    expect(sanitizeIncoming("nope")).toEqual([]);
  });

  it("appends new ids and only fills empty fields of known ones", () => {
    const existing = [{ id: "1111111", url: "a", title: "", company: "", location: "", source: "linkedin" as const, addedAt: 1 }];
    const { jobs, added } = mergeCollected(
      existing,
      [
        { id: "1111111", url: "a", title: "Engineer", company: "Acme", location: "" },
        { id: "2222222", url: "b", title: "Designer", company: "Initech", location: "Remote" },
      ],
      5,
    );
    expect(added).toEqual(["2222222"]);
    expect(jobs).toEqual([
      { id: "1111111", url: "a", title: "Engineer", company: "Acme", location: "", source: "linkedin", addedAt: 1 },
      { id: "2222222", url: "b", title: "Designer", company: "Initech", location: "Remote", source: "linkedin", addedAt: 5 },
    ]);
    expect(existing[0].title).toBe("");
  });
});

describe("employer posting lookup", () => {
  const job = { title: "Senior Go Engineer (m/w/d)", company: "Acme Robotics GmbH", location: "Munich, Germany" };

  it("never takes a job board, and needs the company named", () => {
    expect(isJobBoardUrl("https://de.linkedin.com/jobs/view/1/")).toBe(true);
    expect(isJobBoardUrl("https://www.indeed.co.uk/viewjob?jk=1")).toBe(true);
    expect(isJobBoardUrl("https://www.stepstone.de/stellenangebote--x")).toBe(true);
    expect(isJobBoardUrl("https://jobs.lever.co/acme/1")).toBe(false);
    expect(scoreEmployerHit({ title: "Senior Go Engineer - Acme Robotics", url: "https://www.linkedin.com/jobs/view/1/", content: "" }, job)).toBe(0);
    expect(scoreEmployerHit({ title: "Senior Go Engineer", url: "https://jobs.lever.co/othercorp/1", content: "Othercorp is hiring" }, job)).toBe(0);
    expect(scoreEmployerHit({ title: "Senior Go Engineer", url: "https://jobs.lever.co/acmerobotics/1", content: "" }, job)).toBe(1);
  });

  it("ranks the employer's own postings, best first, without duplicates or boards", () => {
    const ranked = rankEmployerHits(
      [
        { title: "Senior Go Engineer | Acme Robotics | LinkedIn", url: "https://www.linkedin.com/jobs/view/4100000003/", content: "" },
        { title: "Go Engineer", url: "https://boards.greenhouse.io/acmerobotics/jobs/1?gh_src=x", content: "Acme Robotics builds robots" },
        { title: "Senior Go Engineer (m/w/d)", url: "https://acme-robotics.jobs.personio.de/job/77", content: "Acme Robotics GmbH" },
        { title: "Senior Go Engineer (m/w/d)", url: "https://acme-robotics.jobs.personio.de/job/77?language=de", content: "Acme Robotics GmbH" },
        { title: "Marketing Manager", url: "https://acme-robotics.jobs.personio.de/job/78", content: "Acme Robotics GmbH" },
      ],
      job,
    );
    expect(ranked.map((r) => r.url)).toEqual(["https://acme-robotics.jobs.personio.de/job/77", "https://boards.greenhouse.io/acmerobotics/jobs/1?gh_src=x"]);
    expect(ranked.every((r) => r.source === "linkedin" && r.sources?.join() === "linkedin,tavily")).toBe(true);
  });
});

describe("agent bridge", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never sends a LinkedIn link to the agent", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(isLinkedInUrl("https://www.linkedin.com/jobs/view/4100000001/")).toBe(true);
    expect(isLinkedInUrl("https://de.linkedin.com/jobs/view/1")).toBe(true);
    expect(isLinkedInUrl("https://jobs.lever.co/acme/1")).toBe(false);
    await expect(
      applyViaAgent({ port: 1, token: "t" }, "https://www.linkedin.com/jobs/view/4100000001/", { ...EMPTY_JOB, url: "https://www.linkedin.com/jobs/view/4100000001/" }),
    ).rejects.toThrow(/LinkedIn links never go to the agent/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("on-page collector", () => {
  const sent: unknown[] = [];

  beforeEach(() => {
    loadLinkedInFixture();
    sent.length = 0;
    window.__fillerLinkedInTestHref = SEARCH_HREF;
    vi.stubGlobal("chrome", {
      runtime: {
        onMessage: { addListener: vi.fn() },
        sendMessage: vi.fn(async (message: { type: string; jobs?: { id: string }[] }) => {
          sent.push(message);
          if (message.type === "LINKEDIN_APPLY_VIA_AGENT") return { type: "LINKEDIN_AGENT_RESULT", ok: true, message: "Queued in the agent (queued)." };
          if (message.type === "LINKEDIN_ADD_JOBS") return { type: "LINKEDIN_JOBS_ADDED", added: message.jobs!.length, total: message.jobs!.length, ids: message.jobs!.map((j) => j.id) };
          return { type: "LINKEDIN_COLLECTED", ids: [] };
        }),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.__fillerLinkedInCollector?.stop();
    window.__fillerLinkedInCollector = undefined;
    window.__fillerLinkedInTestHref = undefined;
    vi.unstubAllGlobals();
  });

  it("mounts one host element, does nothing until clicked, then sends the page's jobs once", async () => {
    // The shadow root is closed; catch it as it's attached, to click like a user would.
    const roots: ShadowRoot[] = [];
    const attach = Element.prototype.attachShadow;
    vi.spyOn(Element.prototype, "attachShadow").mockImplementation(function (this: Element, init: ShadowRootInit) {
      const root = attach.call(this, init);
      roots.push(root);
      return root;
    });
    const pageClicks = vi.fn();
    document.addEventListener("click", pageClicks);

    bootLinkedInCollector();
    bootLinkedInCollector(); // injected twice: still one collector
    expect(document.querySelectorAll("filler-linkedin")).toHaveLength(1);
    expect(roots).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Only "which are collected already?" so far — nothing is added without a click.
    expect(sent.map((m) => (m as { type: string }).type)).toEqual(["GET_LINKEDIN_COLLECTED"]);

    const primary = roots[0].querySelector<HTMLButtonElement>("button.primary")!;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(primary.textContent).toBe("+ Add all (4)");
    primary.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const add = sent.find((m) => (m as { type: string }).type === "LINKEDIN_ADD_JOBS") as { jobs: { id: string }[] };
    expect(add.jobs.map((job) => job.id)).toEqual(["4100000003", "4100000004", "4100000005", "4100000006"]);
    const toast = roots[0].querySelector(".toast")!.textContent;
    expect(toast).toContain("Added 4 new · 4 in Filler.");
    expect(toast).toContain("1 Easy Apply skipped");
    expect(toast).toContain("1 not loaded yet");

    // "Apply via Filler AI": the selected job and the employer's link behind LinkedIn's Apply.
    roots[0].querySelector<HTMLButtonElement>("button.agent")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const handoff = sent.find((m) => (m as { type: string }).type === "LINKEDIN_APPLY_VIA_AGENT") as { job: { id: string; title: string }; applyUrl: string; description: string };
    expect(handoff.job).toMatchObject({ id: "4100000003", title: "Senior Go Engineer" });
    expect(handoff.applyUrl).toBe("https://jobs.ashbyhq.com/acme-robotics/b2a28043-1f79-4557-8239-de62277a0e3f?Inbound=LinkedIn+Job+Wrapping");
    expect(handoff.description).toContain("warehouse robots");
    expect(roots[0].querySelector(".toast")!.textContent).toBe("Queued in the agent (queued).");
    // Our click never reached LinkedIn's own document listeners.
    expect(pageClicks).not.toHaveBeenCalled();
    document.removeEventListener("click", pageClicks);
  });

  it("stays idle off the jobs pages", () => {
    window.__fillerLinkedInTestHref = "https://www.linkedin.com/feed/";
    bootLinkedInCollector();
    expect(document.querySelectorAll("filler-linkedin")).toHaveLength(0);
  });
});

describe("employer link behind LinkedIn's Apply button", () => {
  it("unwraps /safety/go/, /redir/redirect/ and externalApply, dropping tracking parameters", () => {
    expect(
      unwrapLinkedInRedirect(
        "https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fbolt.eu%2Fen%2Fcareers%2Fpositions%2F%3Fashby_jid%3Db2a28043-1f79-4557-8239-de62277a0e3f%26utm_source%3DK2Jpl6vlvB%26Inbound%3DLinkedIn%2BJob%2BWrapping&urlhash=QQDq&mt=dFY5&isSdui=true&lipi=urn%3Ali%3Apage%3Ad_flagship3_nlsearch_srp_jobs%3B0NP7udjrRhWiL4AeHTnwCA%3D%3D",
      ),
    ).toBe("https://bolt.eu/en/careers/positions/?ashby_jid=b2a28043-1f79-4557-8239-de62277a0e3f&Inbound=LinkedIn+Job+Wrapping");
    expect(unwrapLinkedInRedirect("/redir/redirect/?url=https%3A%2F%2Fjobs.lever.co%2Facme%2F1&urlhash=x")).toBe("https://jobs.lever.co/acme/1");
    expect(unwrapLinkedInRedirect("https://www.linkedin.com/jobs/view/externalApply/4100000001?url=https%3A%2F%2Facme.example%2Fjobs%2F1")).toBe("https://acme.example/jobs/1");
    expect(unwrapLinkedInRedirect("https://boards.greenhouse.io/acme/jobs/1?utm_medium=linkedin")).toBe("https://boards.greenhouse.io/acme/jobs/1");
    // Never back to LinkedIn, never a non-web URL, never another LinkedIn page.
    expect(unwrapLinkedInRedirect("https://www.linkedin.com/safety/go/?url=https%3A%2F%2Fde.linkedin.com%2Fjobs%2Fview%2F1")).toBe("");
    expect(unwrapLinkedInRedirect("https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)")).toBe("");
    expect(unwrapLinkedInRedirect("https://www.linkedin.com/jobs/view/4100000001/")).toBe("");
    expect(cleanEmployerUrl("ftp://acme.example/")).toBe("");
  });

  it("reads the selected job's Apply link, not a link in its description", () => {
    loadLinkedInFixture();
    expect(employerApplyUrl(document)).toBe(
      "https://jobs.ashbyhq.com/acme-robotics/b2a28043-1f79-4557-8239-de62277a0e3f?Inbound=LinkedIn+Job+Wrapping",
    );
  });

  it("returns the Apply element itself, for the button placed next to it", () => {
    loadLinkedInFixture();
    const found = findApplyLink(document)!;
    expect(found.link.getAttribute("aria-label")).toBe("Apply on company website");
    expect(found.url).toContain("jobs.ashbyhq.com");
  });

  it("finds none for an Easy Apply job", () => {
    document.body.innerHTML = `<div data-sdui-screen="com.linkedin.sdui.jobs.SemanticJobDetails">
      <a href="/jobs/view/4100000001/">Engineer</a>
      <a href="https://www.linkedin.com/jobs/view/4100000001/apply/?openSDUIApplyFlow=true">Easy Apply</a>
      <button>Easy Apply</button>
      <div componentkey="JobDetails_AboutTheJob_1"><a href="https://www.linkedin.com/safety/go/?url=https%3A%2F%2Facme.example%2Fapply">Apply here</a></div>
    </div>`;
    expect(employerApplyUrl(document)).toBe("");
  });
});
