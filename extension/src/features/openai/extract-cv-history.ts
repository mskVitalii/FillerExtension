import type { CvHistory, EducationEntry, WorkEntry } from "@/features/autofill/ats/types";
import { requestStructured } from "./client";

/**
 * Work history and education read out of the CV's text, for ATS repeaters that ask
 * for them field by field (Workday's "My Experience", see `fillWorkdayExperience`).
 * A support task: the support model, low reasoning effort. Callers should cache the
 * result per CV (it only changes when the CV does).
 */

const DATE = { type: "string", description: "YYYY-MM, or YYYY when the CV gives only a year; empty when unknown" };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["work", "education", "websites"],
  properties: {
    work: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "location", "from", "to", "description"],
        properties: {
          title: { type: "string" },
          company: { type: "string" },
          location: { type: "string" },
          from: DATE,
          to: { type: "string", description: "YYYY-MM or YYYY; empty for the current job" },
          description: { type: "string", description: "Two or three sentences from the CV's own bullet points; no new claims" },
        },
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["school", "degree", "fieldOfStudy", "from", "to", "grade"],
        properties: {
          school: { type: "string" },
          degree: { type: "string", description: "As written, e.g. 'M.Sc.', 'Bachelor of Arts', 'Abitur'" },
          fieldOfStudy: { type: "string" },
          from: DATE,
          to: DATE,
          grade: { type: "string" },
        },
      },
    },
    websites: { type: "array", items: { type: "string" } },
  },
} as const;

const SYSTEM_PROMPT = `You read a CV and return its work history and education exactly as written, newest first.
- Never invent an employer, title, school, date or grade. Leave a field empty when the CV doesn't say it.
- Dates as YYYY-MM (or YYYY when only the year is given). A current job has an empty "to".
- Websites: portfolio, GitHub, personal site; not LinkedIn, not email.`;

const YM_RE = /^\d{4}(-\d{2})?$/;

function cleanDate(value: unknown): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return YM_RE.test(s) ? s : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Validates and normalizes the model's JSON; drops entries without the fields a form requires. */
export function parseCvHistory(raw: string): CvHistory {
  const data = JSON.parse(raw) as { work?: unknown[]; education?: unknown[]; websites?: unknown[] };
  const work: WorkEntry[] = [];
  for (const item of Array.isArray(data.work) ? data.work : []) {
    const w = item as Record<string, unknown>;
    const from = cleanDate(w.from);
    if (!text(w.title) || !text(w.company) || !from) continue;
    work.push({
      title: text(w.title),
      company: text(w.company),
      location: text(w.location) || undefined,
      from,
      to: cleanDate(w.to) ?? null,
      description: text(w.description) || undefined,
    });
  }
  const education: EducationEntry[] = [];
  for (const item of Array.isArray(data.education) ? data.education : []) {
    const e = item as Record<string, unknown>;
    if (!text(e.school)) continue;
    education.push({
      school: text(e.school),
      degree: text(e.degree) || undefined,
      fieldOfStudy: text(e.fieldOfStudy) || undefined,
      from: cleanDate(e.from),
      to: cleanDate(e.to),
      grade: text(e.grade) || undefined,
    });
  }
  const websites = (Array.isArray(data.websites) ? data.websites : [])
    .map(text)
    .filter((u) => /^https?:\/\//i.test(u) && !/linkedin\.com/i.test(u));
  return { work, education, websites };
}

export function extractCvHistory(cvText: string): Promise<CvHistory> {
  return requestStructured({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `CV:\n${cvText.slice(0, 30_000)}`,
    schemaName: "cv_history",
    schema: SCHEMA,
    reasoningEffort: "low",
    parse: parseCvHistory,
  });
}
