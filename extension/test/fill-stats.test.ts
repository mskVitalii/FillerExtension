import { describe, expect, it } from "vitest";
import { atsOf, mergeFillRuns, summarizeFillRuns, type FillRun } from "@/features/fill-stats/stats";

const run = (over: Partial<FillRun>): FillRun => ({ id: "r", at: "2026-11-18T10:00:00", source: "extension", host: "x.com", ats: null, fields: [], ...over });

describe("fill stats", () => {
  it("recognizes ATSs, embedded ones too", () => {
    expect(atsOf("https://job-boards.greenhouse.io/embed/job_app?for=x")).toBe("greenhouse");
    expect(atsOf("https://www.workato.com/careers/x?gh_jid=1")).toBe("greenhouse");
    expect(atsOf("https://acme.wd3.myworkdayjobs.com/en-US/jobs")).toBe("workday");
    expect(atsOf("https://acme.com/jobs", undefined)).toBeNull();
  });

  it("summarizes per source: Filler's rate counts only fields it could act on", () => {
    const summary = summarizeFillRuns([
      run({
        id: "a",
        ats: "greenhouse",
        fields: [
          { kind: "text", field: "email", label: "Email", filler: "filled" },
          { kind: "combobox", field: "country", label: "Country", filler: "lost" },
          { kind: "text", field: "website", label: "Website", filler: "no-value" },
        ],
      }),
      run({
        id: "b",
        source: "agent",
        ats: "greenhouse",
        fields: [
          { kind: "text", field: "filler-autofill", label: "Email", filler: "filled", final: "ok" },
          { kind: "combobox", field: "profile", label: "Pronouns", filler: "missed", final: "ok" },
          { kind: "combobox", field: "faq", label: "Gender", filler: "other", final: "empty" },
        ],
      }),
    ]);
    expect(summary.totals.extension).toEqual({ total: 2, ok: 1 });
    expect(summary.totals.fillerInAgent).toEqual({ total: 2, ok: 1 });
    expect(summary.totals.agentFinal).toEqual({ total: 3, ok: 2 });
    expect(summary.misses.map((m) => [m.kind, m.outcome, m.count])).toEqual([
      ["combobox", "lost", 1],
      ["combobox", "missed", 1],
    ]);
    expect(summary.unresolved[0].examples).toEqual(["Gender"]);
    expect(summary.days).toHaveLength(1);
  });

  it("merges runs by id, newest kept", () => {
    const merged = mergeFillRuns([run({ id: "a" }), run({ id: "b", at: "2026-11-19T00:00:00" })], [run({ id: "a", host: "y.com" })], 1);
    expect(merged.map((r) => r.id)).toEqual(["b"]);
    expect(mergeFillRuns([run({ id: "a" })], [run({ id: "a", host: "y.com" })])[0].host).toBe("y.com");
  });
});
