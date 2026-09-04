import type { EMPTY_PROFILE } from "@/types/profile";
import { EMPTY_PROFILE as EMPTY } from "@/types/profile";

/** One representative profile shared across the fixture-page tests. */
export function testProfile(): typeof EMPTY_PROFILE {
  return {
    ...EMPTY,
    salutation: "Ms",
    pronouns: "they/them",
    firstName: "Ada",
    lastName: "Lovelace",
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    // Deliberately the exact raw shape reported broken: no "+", no leading
    // trunk 0 — just the national significant number.
    phone: "1745624691",
    address: "12 Analytical Engine Ave",
    city: "Berlin",
    postalCode: "10115",
    country: "Germany",
    linkedin: "https://linkedin.com/in/ada-lovelace",
    github: "https://github.com/ada",
    website: "https://ada.dev",
    expectedSalary: "65000",
  };
}
