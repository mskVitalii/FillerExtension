import { describe, expect, it } from "vitest";
import { ATS_ADAPTERS, detectAts } from "@/features/autofill/ats";
import { loadAtsFixture } from "./harness";
import { atsFixtures } from "./load-ats-fixture";

const adapter = (id: string) => ATS_ADAPTERS.find((a) => a.id === id)!;

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("ATS detection", () => {
  it.each([
    ["https://heo-jobs.dvinci-hr.com/de/jobs/20353/form", "dvinci"],
    ["https://ifa-portal.rexx-recruitment.com/Depotverwaltung-mwd-in-Teilzeit-50--de-f1332.html", "rexx"],
    ["https://nobix-portal.rexx-systems.com/stellenangebote.html", "rexx"],
    ["https://recruitingapp-5230.de.umantis.com/Vacancies/711/Application/New/1", "umantis"],
    ["https://amazone.concludis.de/candidate/formapply?prj=12240", "concludis"],
    ["https://jobs.smartrecruiters.com/oneclick-ui/company/DeliveryHero/publication/f0cce95e", "smartrecruiters"],
  ])("%s → %s", (url, id) => {
    page("");
    expect(detectAts(url, document)?.id).toBe(id);
  });

  it("recognizes every snapshot by its DOM alone (an ATS behind a company domain)", () => {
    for (const ats of ["dvinci", "rexx", "umantis", "concludis"]) {
      for (const file of atsFixtures(ats)) {
        loadAtsFixture(ats, file);
        expect(detectAts("https://careers.example.com/apply", document)?.id, `${ats}/${file}`).toBe(ats);
      }
    }
  });

  it("an unrelated page has no adapter", () => {
    page('<form><input name="email"></form>');
    expect(detectAts("https://careers.example.com/apply", document)).toBeNull();
  });
});

describe("the way to the form", () => {
  it("d.vinci: the posting and the intro chooser lead to /form", () => {
    const dv = adapter("dvinci");
    page('<a href="/de/jobs/20353/form" class="btn btn-apply-with">Bewerbungsformular ausfüllen</a>');
    expect(dv.formEntry!(new URL("https://heo-jobs.dvinci-hr.com/de/jobs/20353/intro"), document)?.url).toBe(
      "https://heo-jobs.dvinci-hr.com/de/jobs/20353/form",
    );
    page("<p>posting</p>");
    expect(dv.formEntry!(new URL("https://heo-jobs.dvinci-hr.com/de/jobs/20353/director-it"), document)?.url).toBe(
      "https://heo-jobs.dvinci-hr.com/de/jobs/20353/form",
    );
    expect(dv.formEntry!(new URL("https://heo-jobs.dvinci-hr.com/de/jobs/20353/form"), document)).toBeNull();
  });

  it("rexx: the -j posting maps to its -f form", () => {
    page("<p>posting</p>");
    expect(
      adapter("rexx").formEntry!(new URL("https://ifa-portal.rexx-recruitment.com/Depotverwaltung-mwd-in-Teilzeit-50--de-j1332.html"), document)?.url,
    ).toBe("https://ifa-portal.rexx-recruitment.com/Depotverwaltung-mwd-in-Teilzeit-50--de-f1332.html");
  });

  it("umantis: Description → Application/CheckLogin", () => {
    page("<p>posting</p>");
    expect(adapter("umantis").formEntry!(new URL("https://recruitingapp-5608.de.umantis.com/Vacancies/240/Description/1"), document)?.url).toBe(
      "https://recruitingapp-5608.de.umantis.com/Vacancies/240/Application/CheckLogin/1",
    );
  });

  it("concludis: the posting's landing-page link, then 'Weiter' until the last step", () => {
    page('<a href="https://amazone.concludis.de/bewerber/landingpage.php?prj=62P12240&b=6">Online bewerben</a>');
    expect(adapter("concludis").formEntry!(new URL("https://amazone.concludis.de/prj/shw/x_0/12240/a.htm"), document)?.url).toContain(
      "/bewerber/landingpage.php?prj=62P12240",
    );
    loadAtsFixture("concludis", "cellitinnen-pflegefachkraft.html");
    const next = adapter("concludis").nextStep!(document);
    expect(next?.textContent).toContain("Weiter");
    for (const s of document.querySelectorAll(".form-section")) s.classList.toggle("current");
    expect(adapter("concludis").nextStep!(document)).toBeNull();
  });

  it("SmartRecruiters: Delivery Hero's Apply goes through /Workflow", () => {
    page('<a href="/Workflow?workflowId=2c70c3d4-6a92-46f1-8d4f-db8e6cf4af6e&amp;vacancyId=11701" class="btn">Apply</a>');
    const url = new URL("https://careers.deliveryhero.com/job/senior-software-engineer-go-in-berlin-germany-jid-11701");
    expect(detectAts(url.href, document)?.id).toBe("smartrecruiters");
    expect(adapter("smartrecruiters").formEntry!(url, document)?.url).toBe(
      "https://careers.deliveryhero.com/Workflow?workflowId=2c70c3d4-6a92-46f1-8d4f-db8e6cf4af6e&vacancyId=11701",
    );
  });
});
