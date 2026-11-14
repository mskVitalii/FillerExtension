import { describe, expect, it } from "vitest";
import { emailSubject } from "@/features/openai/outreach-message";
import { isEmailAddress } from "@/lib/email";

const job = { position: "Founding AI Engineer", company: "ELANI One" };

describe("outreach email subject", () => {
  it("keeps the model's subject, minus a 'Subject:' prefix and em dashes", () => {
    expect(emailSubject("Subject: Founding AI Engineer — agentic platforms", job)).not.toMatch(/^Subject|—/);
    expect(emailSubject("Founding AI Engineer role at ELANI One", job)).toBe("Founding AI Engineer role at ELANI One");
  });

  it("builds one from the posting when the model left it out", () => {
    expect(emailSubject(null, job)).toBe("Founding AI Engineer at ELANI One");
    expect(emailSubject("   ", job)).toBe("Founding AI Engineer at ELANI One");
    expect(emailSubject(null, { position: "", company: "" })).toBe("Job application");
  });

  it("tells an email contact from a LinkedIn one", () => {
    expect(isEmailAddress("careers@elani.one")).toBe(true);
    expect(isEmailAddress(" careers@elani.one ")).toBe(true);
    expect(isEmailAddress("https://www.linkedin.com/in/someone/")).toBe(false);
  });
});
