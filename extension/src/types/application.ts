import type { Job } from "./job";

export type ApplicationStatus = "draft" | "applied" | "interview" | "rejected" | "offer";

/** The adapted CV last previewed/attached/downloaded for this posting (Adapt CV tab or the main view). */
export interface AdaptedCvRecord {
  /** File name of the PDF in Drive `appDataFolder`. */
  driveName: string;
  /** Name it downloads under, e.g. "Jane Doe CV.pdf". */
  fileName: string;
  /** The library CV it was adapted from (`CvMeta.id` / `.fileName`) — the file name survives that CV's deletion. */
  cvId: string;
  cvFileName: string;
  /** Placeholder values it was filled with, so the list can say what was changed for this posting. */
  values: Record<string, string>;
  savedAt: string;
}

export interface Application {
  id: string;
  company: string;
  position: string;
  url: string;
  job: Job;
  /** Empty when the record was created by saving an adapted CV before any cover letter. */
  coverLetter: string;
  adaptedCv?: AdaptedCvRecord;
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
