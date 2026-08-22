import type { Job } from "./job";

export type ApplicationStatus = "draft" | "applied" | "interview" | "rejected" | "offer";

export interface Application {
  id: string;
  company: string;
  position: string;
  url: string;
  job: Job;
  coverLetter: string;
  createdAt: string;
  updatedAt: string;
  status: ApplicationStatus;
}
