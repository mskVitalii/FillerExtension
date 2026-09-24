import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { cn } from "@/lib/utils";
import { ROLLING_WINDOW_DAYS, type SubmissionPoint } from "@/features/applications/stats";

/**
 * Grafana's own time-series panel is built on uPlot, so this reuses the
 * same engine with Grafana's light-theme palette (matching the panel's own
 * light tokens rather than a dark island): a per-day line with its
 * trailing-30-day mean on top, and a cumulative panel underneath sharing
 * one x-range and one crosshair. The visible window slides (presets,
 * ‹ › shift, drag-to-zoom, double-click to reset) instead of squeezing a
 * months-long search into the panel width.
 */

const DAY_S = 24 * 60 * 60;

const THEME = {
  panel: "hsl(var(--background))",
  border: "hsl(var(--border))",
  text: "#64748b",
  textStrong: "#0f172a",
  grid: "rgba(15, 23, 42, 0.07)",
  green: "#56a64b",
  yellow: "#e0b400",
  blue: "#3274d9",
};

const PRESETS = [
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
  { id: "6m", label: "6m", days: 182 },
  { id: "all", label: "All", days: null },
] as const;
type PresetId = (typeof PRESETS)[number]["id"];

type Range = [number, number];

const SYNC_KEY = "filler-submissions";

function toSeconds(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime() / 1000;
}

function presetRange(preset: PresetId, first: number, last: number): Range {
  const days = PRESETS.find((p) => p.id === preset)!.days;
  // Pad a single-day history so the scale isn't zero-width.
  if (days === null) return first === last ? [first - DAY_S, last + DAY_S] : [first, last];
  return [last - (days - 1) * DAY_S, last];
}

const dayFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: "short" });
const monthYearFormat = new Intl.DateTimeFormat(undefined, { month: "short", year: "2-digit" });
const fullFormat = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

function xAxisValues(_u: uPlot, splits: number[], _axisIdx: number, _space: number, incr: number): string[] {
  return splits.map((s, i) => {
    const date = new Date(s * 1000);
    if (incr < 28 * DAY_S) return dayFormat.format(date);
    const prev = i > 0 ? new Date(splits[i - 1] * 1000) : null;
    return !prev || prev.getFullYear() !== date.getFullYear() ? monthYearFormat.format(date) : monthFormat.format(date);
  });
}

function gradientFill(color: string) {
  return (u: uPlot) => {
    const gradient = u.ctx.createLinearGradient(0, u.bbox.top, 0, u.bbox.top + u.bbox.height);
    gradient.addColorStop(0, `${color}55`);
    gradient.addColorStop(1, `${color}00`);
    return gradient;
  };
}

function axis(overrides: Partial<uPlot.Axis> = {}): uPlot.Axis {
  return {
    stroke: THEME.text,
    font: "10px system-ui, sans-serif",
    grid: { stroke: THEME.grid, width: 1 },
    ticks: { show: false },
    gap: 4,
    ...overrides,
  };
}

interface ChartHandlers {
  onHover: (idx: number | null) => void;
  onZoom: (range: Range) => void;
  onReset: () => void;
}

function baseOptions(height: number, handlers: React.MutableRefObject<ChartHandlers>, showXAxis: boolean): uPlot.Options {
  return {
    width: 300,
    height,
    padding: [8, 8, showXAxis ? 0 : 4, 0],
    legend: { show: false },
    cursor: {
      sync: { key: SYNC_KEY, setSeries: false },
      points: { size: 6, width: 1.5, stroke: "#ffffff" },
      drag: { x: true, y: false, setScale: false },
      bind: {
        dblclick: () => () => {
          handlers.current.onReset();
          return null;
        },
      },
    },
    scales: {
      x: { time: true, auto: false },
      y: { range: (_u, _min, max) => [0, Math.max(1, Math.ceil(max * 1.15))] },
    },
    hooks: {
      setCursor: [(u) => handlers.current.onHover(u.cursor.idx ?? null)],
      setSelect: [
        (u) => {
          if (u.select.width < 4) return;
          const min = u.posToVal(u.select.left, "x");
          const max = u.posToVal(u.select.left + u.select.width, "x");
          u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
          handlers.current.onZoom([min, max]);
        },
      ],
    },
    series: [{}],
    axes: [
      axis({ show: showXAxis, size: 20, space: 48, values: xAxisValues }),
      // Same fixed width on both plots so their x pixels (and the synced crosshair) line up.
      axis({ size: 34, incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000] }),
    ],
  };
}

interface SubmissionsTimelineProps {
  series: SubmissionPoint[];
}

export function SubmissionsTimeline({ series }: SubmissionsTimelineProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dailyRef = useRef<HTMLDivElement>(null);
  const totalRef = useRef<HTMLDivElement>(null);
  const plotsRef = useRef<uPlot[]>([]);

  const xs = useMemo(() => series.map((p) => toSeconds(p.date)), [series]);
  const first = xs[0];
  const last = xs[xs.length - 1];

  const defaultPreset: PresetId = useMemo(() => {
    const recent = series.slice(-ROLLING_WINDOW_DAYS).some((p) => p.count > 0);
    return recent && series.length > ROLLING_WINDOW_DAYS ? "30d" : "all";
  }, [series]);

  const [preset, setPreset] = useState<PresetId | null>(defaultPreset);
  const [range, setRange] = useState<Range>(() => presetRange(defaultPreset, first, last));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handlers = useRef<ChartHandlers>({ onHover: () => {}, onZoom: () => {}, onReset: () => {} });
  handlers.current = {
    onHover: setHoverIdx,
    onZoom: (next) => {
      // Never zoom tighter than two days — a sub-day scale has nothing to show.
      if (next[1] - next[0] < 2 * DAY_S) return;
      setPreset(null);
      setRange(next);
    },
    onReset: () => {
      const target = preset ?? defaultPreset;
      setPreset(target);
      setRange(presetRange(target, first, last));
    },
  };

  // (Re)build both plots when the data changes; range and size are applied separately below.
  useEffect(() => {
    if (!dailyRef.current || !totalRef.current) return;
    const daily = new uPlot(
      {
        ...baseOptions(128, handlers, false),
        series: [
          {},
          {
            label: "Per day",
            // Slightly translucent so the 30-day mean stays the dominant line on wide windows.
            stroke: `${THEME.green}b3`,
            width: 1,
            fill: gradientFill(THEME.green),
            points: { show: false },
          },
          {
            label: `${ROLLING_WINDOW_DAYS}-day avg`,
            stroke: THEME.yellow,
            width: 2,
            points: { show: false },
          },
        ],
      },
      [xs, series.map((p) => p.count), series.map((p) => p.rolling)],
      dailyRef.current,
    );
    const total = new uPlot(
      {
        ...baseOptions(96, handlers, true),
        scales: {
          x: { time: true, auto: false },
          // A running total only grows; anchoring at 0 would flatten the visible window into a line.
          y: {
            range: (_u, min, max) => {
              const pad = Math.max(1, (max - min) * 0.15);
              return [Math.max(0, Math.floor(min - pad)), Math.ceil(max + pad)];
            },
          },
        },
        series: [
          {},
          {
            label: "Total",
            stroke: THEME.blue,
            width: 1.75,
            fill: gradientFill(THEME.blue),
            points: { show: false },
          },
        ],
      },
      [xs, series.map((p) => p.cumulative)],
      totalRef.current,
    );
    plotsRef.current = [daily, total];

    const resize = () => {
      const width = wrapRef.current?.clientWidth ?? 300;
      for (const plot of plotsRef.current) plot.setSize({ width, height: plot.height });
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (wrapRef.current) observer.observe(wrapRef.current);

    return () => {
      observer.disconnect();
      daily.destroy();
      total.destroy();
      plotsRef.current = [];
    };
  }, [xs, series]);

  useEffect(() => {
    for (const plot of plotsRef.current) plot.setScale("x", { min: range[0], max: range[1] });
  }, [range, xs]);

  function shift(direction: -1 | 1) {
    const width = range[1] - range[0];
    const step = Math.max(DAY_S, Math.round(width / 2 / DAY_S) * DAY_S) * direction;
    let min = range[0] + step;
    let max = range[1] + step;
    if (max > last) [min, max] = [last - width, last];
    if (min < first - DAY_S) [min, max] = [first - DAY_S, first - DAY_S + width];
    setPreset(null);
    setRange([min, max]);
  }

  const shown = (hoverIdx !== null && series[hoverIdx]) || series[series.length - 1];

  return (
    <div
      className="flex flex-col rounded-md border p-2 text-[11px]"
      style={{ background: THEME.panel, borderColor: THEME.border, color: THEME.text }}
    >
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="font-medium" style={{ color: THEME.textStrong }}>
          Submissions
        </span>
        <div className="flex items-center gap-0.5">
          <RangeButton onClick={() => shift(-1)} disabled={range[0] <= first - DAY_S} aria-label="Earlier">
            <ChevronLeft className="h-3 w-3" />
          </RangeButton>
          {PRESETS.map((p) => (
            <RangeButton
              key={p.id}
              active={preset === p.id}
              onClick={() => {
                setPreset(p.id);
                setRange(presetRange(p.id, first, last));
              }}
            >
              {p.label}
            </RangeButton>
          ))}
          <RangeButton onClick={() => shift(1)} disabled={range[1] >= last} aria-label="Later">
            <ChevronRight className="h-3 w-3" />
          </RangeButton>
        </div>
      </div>

      {/* One fixed-height, non-wrapping row with fixed-width slots, so hovering never reflows the plots below. */}
      <div className="flex h-4 items-center gap-3 overflow-hidden whitespace-nowrap pb-1 tabular-nums">
        <span className="w-[4.75rem] shrink-0" style={{ color: THEME.textStrong }}>{fullFormat.format(new Date(`${shown.date}T00:00:00`))}</span>
        <LegendItem color={THEME.green} label="Per day" value={String(shown.count)} />
        <LegendItem color={THEME.yellow} label={`${ROLLING_WINDOW_DAYS}d avg`} value={shown.rolling.toFixed(1)} />
        <LegendItem color={THEME.blue} label="Total" value={String(shown.cumulative)} />
      </div>

      <div ref={wrapRef} className="flex flex-col" onMouseLeave={() => setHoverIdx(null)}>
        <div ref={dailyRef} />
        <div className="px-0.5 pt-1" style={{ borderTop: `1px solid ${THEME.border}` }}>
          <span>Cumulative</span>
        </div>
        <div ref={totalRef} />
      </div>

      <p className="pt-1 text-[10px] opacity-70">Drag to zoom · double-click to reset</p>
    </div>
  );
}

function RangeButton({
  active,
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-5 min-w-5 items-center justify-center rounded-sm px-1.5 text-[10px] font-medium transition-colors",
        "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
        active ? "bg-[#3d71d9] text-white hover:bg-[#3d71d9] hover:text-white" : "",
        className,
      )}
      {...props}
    />
  );
}

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />
      {label}
      <span className="inline-block min-w-[3ch] font-medium" style={{ color: THEME.textStrong }}>
        {value}
      </span>
    </span>
  );
}
