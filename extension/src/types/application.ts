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
