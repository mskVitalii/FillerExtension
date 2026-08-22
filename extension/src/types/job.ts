export interface Job {
  company: string;
  position: string;
  location: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  salary: string | null;
  techStack: string[];
  contact: string | null;
  url: string;
}

export const EMPTY_JOB: Job = {
  company: "",
  position: "",
  location: "",
  description: "",
  requirements: [],
  responsibilities: [],
  salary: null,
  techStack: [],
  contact: null,
  url: "",
};
