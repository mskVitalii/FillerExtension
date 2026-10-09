import { JOB_GRADES, type JobGrade } from "@/types/job-search";

/** Prompt fragment for the AI-backed providers; "" when no grade is selected. */
export function gradesRefinement(grades: JobGrade[] | undefined): string {
  if (!grades?.length) return "";
  const labels = JOB_GRADES.filter((g) => grades.includes(g.id)).map((g) => g.label.toLowerCase());
  return `Seniority levels to target: ${labels.join(", ")}. Only include postings for these levels.`;
}

/**
 * Adzuna's search is a literal keyword match, so each selected grade becomes
 * its own prefixed term ("junior backend engineer"). A term that already names
 * the grade is left as-is rather than doubled up.
 */
export function applyGradesToTerms(terms: string[], grades: JobGrade[] | undefined): string[] {
  const selected = JOB_GRADES.filter((g) => grades?.includes(g.id));
  if (selected.length === 0) return terms;
  const out: string[] = [];
  for (const term of terms) {
    for (const grade of selected) {
      out.push(term.toLowerCase().includes(grade.keyword) ? term : `${grade.keyword} ${term}`.trim());
    }
  }
  return [...new Set(out)];
}
