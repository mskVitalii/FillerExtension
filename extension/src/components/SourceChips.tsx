import type { JobSearchResult } from "@/types/job-search";
import { resultSources, sourceLabel } from "@/features/job-search/sources";
import { useT } from "@/i18n/react";

/** The sources that found a search result, one small chip each, plus "only on the job board" when it has no employer link. */
export function SourceChips({ result }: { result: Pick<JobSearchResult, "source" | "sources" | "boardOnly"> }) {
  const t = useT();
  return (
    <span className="flex flex-wrap items-center gap-1" aria-label={`${t("search.sources")}: ${resultSources(result).map(sourceLabel).join(", ")}`}>
      {resultSources(result).map((source) => (
        <span key={source} className="rounded-full border border-border bg-muted px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground">
          {sourceLabel(source)}
        </span>
      ))}
      {result.boardOnly && (
        <span title={t("search.boardOnlyHint")} className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-px text-[10px] font-medium leading-4 text-amber-800">
          {t("search.boardOnly")}
        </span>
      )}
    </span>
  );
}
