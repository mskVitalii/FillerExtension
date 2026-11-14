import { describe, expect, it } from "vitest";
import { cleanJobTitle } from "@/features/job-extraction/clean-title";

describe("cleanJobTitle", () => {
  it.each([
    ["Senior Backend Engineer (m/w/d)", "Backend Engineer"],
    ["Software Developer (F/M/D) - Remote", "Software Developer"],
    ["Junior Frontend Developer m/f/d", "Frontend Developer"],
    ["Middle Python Developer", "Python Developer"],
    ["Sr. Data Scientist [Hybrid]", "Data Scientist"],
    ["Senior/Lead QA Engineer", "Lead QA Engineer"],
    ["Java Developer (Senior)", "Java Developer"],
    ["Product Manager – Full-time", "Product Manager"],
    ["DevOps Engineer | Acme GmbH", "DevOps Engineer"],
    ["Fullstack Engineer, Senior", "Fullstack Engineer"],
    ["Werkstudent Marketing (all genders)", "Werkstudent Marketing"],
    ["Head of Engineering", "Head of Engineering"],
    ["Team Lead Backend", "Team Lead Backend"],
    ["Senior", "Senior"],
    ["", ""],
  ])("%s → %s", (input, expected) => {
    expect(cleanJobTitle(input)).toBe(expected);
  });
});
