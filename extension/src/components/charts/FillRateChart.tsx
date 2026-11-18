import type { FillDay, FillRate } from "@/features/fill-stats/stats";
import { percent } from "@/features/fill-stats/stats";

export type FillSeries = "extension" | "fillerInAgent" | "agentFinal";

/** Fixed hues, readable on both the light and the dark theme. */
export const FILL_SERIES_COLORS: Record<FillSeries, string> = {
  extension: "hsl(217 91% 60%)",
  fillerInAgent: "hsl(262 83% 62%)",
  agentFinal: "hsl(142 64% 42%)",
};

const ORDER: FillSeries[] = ["extension", "fillerInAgent", "agentFinal"];

const W = 600;
const H = 180;
const PAD = { left: 34, right: 10, top: 10, bottom: 24 };

/**
 * Fill rate per day, one line per source: Filler's autofill in the browser,
 * the same autofill inside agent runs, and agent runs at the end (Filler plus
 * the agent's model). Shared by the Side Panel and the agent's dashboard,
 * which pass their own labels. Days without any field of a series leave a
 * gap in that line rather than a fake 0%.
 */
export function FillRateChart({
  days,
  labels,
  totals,
  series = ORDER,
  locale,
}: {
  days: FillDay[];
  labels: Record<FillSeries, string>;
  totals: Record<FillSeries, FillRate>;
  series?: FillSeries[];
  locale?: string;
}) {
  const shown = series.filter((s) => totals[s].total > 0);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (p: number) => PAD.top + innerH - (p / 100) * innerH;
  const dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" });
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  const segments = (s: FillSeries): string[] => {
    const paths: string[] = [];
    let current = "";
    days.forEach((d, i) => {
      const p = percent(d[s]);
      if (p === null) {
        if (current) paths.push(current);
        current = "";
        return;
      }
      current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p).toFixed(1)}`;
    });
    if (current) paths.push(current);
    return paths;
  };

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {shown.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: FILL_SERIES_COLORS[s] }} />
            <span className="text-muted-foreground">{labels[s]}</span>
            <span className="font-medium tabular-nums">{percent(totals[s]) ?? "—"}%</span>
            <span className="text-muted-foreground tabular-nums">
              ({totals[s].ok}/{totals[s].total})
            </span>
          </li>
        ))}
      </ul>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={shown.map((s) => `${labels[s]} ${percent(totals[s]) ?? "—"}%`).join(", ")}>
        {[0, 50, 100].map((p) => (
          <g key={p}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(p)} y2={y(p)} stroke="currentColor" className="text-border" strokeDasharray={p === 0 ? undefined : "3 3"} />
            <text x={PAD.left - 6} y={y(p) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">
              {p}%
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % labelEvery === 0 || i === days.length - 1 ? (
            <text key={d.date} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
              {dayFormat.format(new Date(`${d.date}T00:00:00`))}
            </text>
          ) : null,
        )}
        {shown.map((s) => (
          <g key={s}>
            {segments(s).map((path, i) => (
              <path key={i} d={path} fill="none" stroke={FILL_SERIES_COLORS[s]} strokeWidth={2} strokeLinejoin="round" />
            ))}
            {days.map((d, i) => {
              const p = percent(d[s]);
              return p === null ? null : (
                <circle key={d.date} cx={x(i)} cy={y(p)} r={3} fill={FILL_SERIES_COLORS[s]}>
                  <title>{`${labels[s]} · ${dayFormat.format(new Date(`${d.date}T00:00:00`))}: ${p}% (${d[s].ok}/${d[s].total})`}</title>
                </circle>
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
