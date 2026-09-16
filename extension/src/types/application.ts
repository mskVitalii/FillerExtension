import type { Job } from "./job";

export type ApplicationStatus = "draft" | "applied" | "interview" | "rejected" | "offer";

export interface Application {
  id: string;
  company: string;
  position: string;
  url: string;
  job: Job;
  coverLetter: string;
  /** Kept in sync with `coverLetter` (spec_2 item 3) — always the latest translation, not a snapshot. */
  translation?: { language: string; content: string };
  createdAt: string;
  updatedAt: string;
  status: ApplicationStatus;
}

/**
 * One job posting URL the extension was activated on (icon clicked), the
 * first time it was seen — a rough proxy for "applied to" that doesn't
 * depend on the user actually saving a cover letter to Drive (spec_6).
 */
export interface UrlActivation {
  url: string;
  /** Local calendar date the URL was first seen, `YYYY-MM-DD`. */
  date: string;
}
