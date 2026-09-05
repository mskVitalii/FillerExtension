import { describe, expect, it } from "vitest";
import { coerceDateInputValue, dateInputKindForType, todayISO } from "@/lib/date-format";

describe("dateInputKindForType", () => {
  it("recognizes every date/time input type the HTML value-sanitization algorithm hard-validates", () => {
    expect(dateInputKindForType("date")).toBe("date");
    expect(dateInputKindForType("month")).toBe("month");
    expect(dateInputKindForType("week")).toBe("week");
    expect(dateInputKindForType("time")).toBe("time");
    expect(dateInputKindForType("datetime-local")).toBe("datetime-local");
  });

  it("returns null for types the browser doesn't hard-validate", () => {
    expect(dateInputKindForType("text")).toBeNull();
    expect(dateInputKindForType("tel")).toBeNull();
    expect(dateInputKindForType("number")).toBeNull();
  });
});

describe("coerceDateInputValue", () => {
  it("passes an already-correct value straight through, per kind", () => {
    expect(coerceDateInputValue("date", "2026-03-01")).toBe("2026-03-01");
    expect(coerceDateInputValue("month", "2026-03")).toBe("2026-03");
    expect(coerceDateInputValue("week", "2026-W09")).toBe("2026-W09");
    expect(coerceDateInputValue("time", "09:30")).toBe("09:30");
    expect(coerceDateInputValue("datetime-local", "2026-03-01T09:30")).toBe("2026-03-01T09:30");
  });

  it("reorders a German dd.mm.yyyy date into yyyy-MM-dd", () => {
    expect(coerceDateInputValue("date", "01.03.2026")).toBe("2026-03-01");
    expect(coerceDateInputValue("date", "1.3.2026")).toBe("2026-03-01");
  });

  it("reorders a German dd.mm.yyyy date embedded in prose", () => {
    expect(coerceDateInputValue("date", "Ich kann ab dem 01.03.2026 beginnen.")).toBe("2026-03-01");
  });

  it("extracts month from a German date for a month input", () => {
    expect(coerceDateInputValue("month", "01.03.2026")).toBe("2026-03");
  });

  it("extracts a German date + time for a datetime-local input", () => {
    expect(coerceDateInputValue("datetime-local", "01.03.2026 09:30")).toBe("2026-03-01T09:30");
  });

  it("falls back to Date.parse for a spelled-out month", () => {
    expect(coerceDateInputValue("date", "March 1, 2026")).toBe("2026-03-01");
  });

  it("never guesses an ISO week from prose", () => {
    expect(coerceDateInputValue("week", "die neunte Woche 2026")).toBeNull();
  });

  it("returns null for a notice-period description with no actual date in it (the reported Stepstone case)", () => {
    expect(coerceDateInputValue("date", "Mit einer Kündigungsfrist von einem Monat.")).toBeNull();
  });

  it("returns null for empty/unparseable prose rather than writing a guess", () => {
    expect(coerceDateInputValue("date", "So bald wie möglich")).toBeNull();
    expect(coerceDateInputValue("time", "irgendwann")).toBeNull();
  });
});

describe("todayISO", () => {
  it("returns today's local date in yyyy-MM-dd", () => {
    // Deliberately not compared against `new Date().toISOString()` — that's
    // UTC and can be a different calendar day than the local date this is
    // meant to produce, depending on the machine's timezone and time of day.
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    expect(todayISO()).toBe(expected);
  });
});
