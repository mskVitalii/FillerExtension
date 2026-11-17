import { useMemo, useState } from "react";
import { useI18n } from "@/i18n/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Application } from "@/types/application";
import {
  computeDayTimeline,
  daysWithTiming,
  formatDuration,
  localDay,
  overallTiming,
} from "@/features/applications/day-timeline";

const HOUR_MS = 60 * 60 * 1000;

/**
 * One day of applying: each application marked applied that day is a bar
 * from when its posting was first read to when it was marked applied, on a
 * shared hour axis — gaps between bars are time spent elsewhere. ‹ › step
 * through the days that have any.
 */
export function DayTimeline({ applications }: { applications: Application[] }) {
  const days = useMemo(() => daysWithTiming(applications), [applications]);
  const [day, setDay] = useState<string | null>(null);
  const shown = day ?? days[0] ?? localDay(Date.now());
  const timeline = useMemo(() => computeDayTimeline(applications, shown), [applications, shown]);
  const overall = useMemo(() => overallTiming(applications), [applications]);
  const index = days.indexOf(shown);
  const { t, locale } = useI18n();
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });

  if (overall.count === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("timeline.empty")}
      </p>
    );
  }

  const span = timeline.axisEnd - timeline.axisStart;
  const hours: number[] = [];
  for (let t = timeline.axisStart; t <= timeline.axisEnd; t += HOUR_MS) hours.push(t);
  const labelEvery = Math.max(1, Math.ceil(hours.length / 6));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          onClick={() => setDay(days[index + 1])}
          disabled={index === -1 || index >= days.length - 1}
          aria-label={t("timeline.prev")}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs font-medium">{dayFormat.format(new Date(`${shown}T00:00:00`))}</span>
        <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
          onClick={() => setDay(days[index - 1])}
          disabled={index <= 0}
          aria-label={t("timeline.next")}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1 text-center text-[11px] text-muted-foreground">
        <span>
          <span className="block text-sm font-semibold text-foreground">{timeline.bars.length}</span>
          {t("timeline.applied")}
        </span>
        <span>
          <span className="block text-sm font-semibold text-foreground">{formatDuration(timeline.totalMs)}</span>
          {t("timeline.total")}
        </span>
        <span>
          <span className="block text-sm font-semibold text-foreground">
            {timeline.bars.length ? formatDuration(timeline.medianMs) : "—"}
          </span>
          {t("timeline.median")}
        </span>
      </div>

      {timeline.bars.length > 0 && (
        <div className="relative rounded-md border border-border bg-muted/20 px-1 pb-5 pt-1">
          {hours.map((t, i) => (
            <div
              key={t}
              className="pointer-events-none absolute bottom-0 top-0 border-l border-border/60"
              style={{ left: `${((t - timeline.axisStart) / span) * 100}%` }}
            >
              {i % labelEvery === 0 && (
                <span className="absolute bottom-0.5 left-0.5 text-[9px] text-muted-foreground">
                  {new Date(t).getHours().toString().padStart(2, "0")}
                </span>
              )}
            </div>
          ))}
          <ul className="relative flex flex-col gap-0.5">
            {timeline.bars.map((bar) => {
              const left = ((bar.start - timeline.axisStart) / span) * 100;
              const width = Math.max(((bar.end - bar.start) / span) * 100, 0.8);
              const label = [bar.position, bar.company].filter(Boolean).join(" · ") || bar.url;
              return (
                <li key={bar.id} className="relative h-4">
                  <a
                    href={bar.url}
                    target="_blank"
                    rel="noreferrer"
                    className="absolute top-0 h-4 rounded-sm bg-primary/70 hover:bg-primary"
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${label}\n${bar.startedEarlier ? t("timeline.startedEarlier") : timeFormat.format(bar.start)} – ${timeFormat.format(bar.end)} · ${formatDuration(bar.durationMs)}`}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {t("timeline.allTime", { count: overall.count, median: formatDuration(overall.medianMs), average: formatDuration(overall.averageMs) })}
      </p>
    </div>
  );
}
