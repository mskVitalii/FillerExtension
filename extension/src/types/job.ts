import type { CefrLevel } from "@/lib/language-level";

/** An explicit language-proficiency requirement found in the posting text (spec_3 item 2). `level` is
 * `null` when the posting names a language but only in unmappable terms (e.g. "fluent English"). */
export interface LanguageRequirement {
  language: string;
  level: CefrLevel | null;
}

export interface JobLanguageInfo {
  /** Language(s) the posting itself is written in — shown up front so applicants don't have to guess. */
  postingLanguages: string[];
  requirements: LanguageRequirement[];
}

/** A notable keyword/phrase extracted from a posting (spec_8 item 2), classified against the
 * applicant's own profile/CV/Personal Legend so the Side Panel list and the on-page highlight
 * can distinguish a skill the applicant already has from a gap in the posting's ask. */
export interface JobKeyword {
  /** Copied verbatim from the posting text — the extension re-finds this exact string on the page. */
  text: string;
  /** True when the applicant's profile/CV/Personal Legend shows they already have/use/meet this. */
  matchesProfile: boolean;
}

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

/** Combined output of the automatic on-load analysis pass (spec_8 item 2): language detection,
 * keyword extraction, and — only when the job's own `contact` came up empty — one more look for a
 * recruiter/hiring contact in the job's own text (`features/openai/analyze-job-brief.ts`, and the
 * merged AI-extraction path in `features/job-extraction/ai-fallback.ts`). */
export interface JobBrief {
  language: JobLanguageInfo;
  keywords: JobKeyword[];
  /** A contact found beyond what the Job already carried — null when one was already known, or none was found. Copied verbatim so it can be highlighted on the page like a keyword. */
  contact: string | null;
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
