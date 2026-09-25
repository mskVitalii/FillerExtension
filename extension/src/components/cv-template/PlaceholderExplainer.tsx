import { ArrowRight } from "lucide-react";
import type { CvTemplateFormat } from "@/types/cv-template";

/** Where the user types a placeholder, per kind of CV file (all three when there's no CV yet). */
export function PlaceholderHowTo({ format }: { format: CvTemplateFormat | null }) {
  const docx = (
    <>
      <span className="font-medium text-foreground">Word:</span> type <code>{"{{city}}"}</code> right into the
      document.
    </>
  );
  const latex = (
    <>
      <span className="font-medium text-foreground">LaTeX:</span> write <code>{"\\{\\{city\\}\\}"}</code> in the .tex
      (<code>{"job\\_position"}</code> for an underscore), then download the Overleaf project as .zip.
    </>
  );
  const pdf = (
    <>
      <span className="font-medium text-foreground">PDF:</span> add <code>{"{{city}}"}</code> wherever you make the
      PDF (Word, Google Docs, Canva…) and export it again. Filler writes the value into that PDF, in its own font.
    </>
  );
  if (format === "docx") return <p>{docx}</p>;
  if (format === "latex") return <p>{latex}</p>;
  if (format === "pdf") return <p>{pdf}</p>;
  return (
    <ul className="flex flex-col gap-1">
      <li>{docx}</li>
      <li>{latex}</li>
      <li>{pdf}</li>
    </ul>
  );
}

function Mark({ children }: { children: string }) {
  return <span className="rounded-sm bg-amber-100 px-0.5 text-amber-950">{children}</span>;
}

/**
 * The whole idea in one picture: the posting's facts go into the
 * `{{placeholders}}` of the user's own CV; the rest of the CV is untouched.
 */
export function PlaceholderExplainer({ title }: { title?: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}

      <div className="rounded border border-dashed border-border bg-background px-2 py-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide">Job posting</p>
        <p className="text-foreground">
          Position: <Mark>Software Engineer</Mark>
          <br />
          Location: <Mark>Chemnitz</Mark>, Germany
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <figure className="min-w-[8.5rem] flex-1 rounded border border-border bg-background px-2 py-1.5">
          <figcaption className="text-[10px] font-medium uppercase tracking-wide">Your CV file</figcaption>
          <p className="font-mono text-[11px] leading-relaxed text-foreground">
            Jane Doe
            <br />
            {"{{job_position}}"}
            <br />
            {"{{city}}"}, Germany
          </p>
        </figure>
        <ArrowRight className="mx-auto h-4 w-4 shrink-0" aria-label="becomes" />
        <figure className="min-w-[8.5rem] flex-1 rounded border border-border bg-background px-2 py-1.5">
          <figcaption className="text-[10px] font-medium uppercase tracking-wide">CV for this job</figcaption>
          <p className="text-[11px] leading-relaxed text-foreground">
            Jane Doe
            <br />
            <Mark>Software Engineer</Mark>
            <br />
            <Mark>Chemnitz</Mark>, Germany
          </p>
        </figure>
      </div>

      <p>
        Put <code>{"{{placeholders}}"}</code> into your own CV. For each job Filler fills them in from the posting —
        nothing else in the CV changes.
      </p>
    </section>
  );
}
