import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/react";
import type { MessageKey } from "@/i18n/core";
import { FillRateChart } from "@/components/charts/FillRateChart";
import { getFillRuns, FILL_STATS_STORAGE_KEY } from "@/features/fill-stats/repository";
import { mergeFillRuns, summarizeFillRuns, type FillRun, type FillerOutcome } from "@/features/fill-stats/stats";
import { agentHealth, fetchAgentFillRuns, getAgentSettings, pushFillRuns } from "@/features/agent-bridge/client";

const OUTCOME_LABEL: Partial<Record<FillerOutcome, MessageKey>> = {
  lost: "fill.outcome.lost",
  failed: "fill.outcome.failed",
  missed: "fill.outcome.missed",
};

/**
 * Autofill quality (Applications → "Autofill quality"): this browser's runs,
 * plus the local agent's when it's connected — the same numbers its dashboard
 * shows, one line per source, and the widgets Filler misses most.
 */
export function FillStatsPanel() {
  const { t, locale } = useI18n();
  const [local, setLocal] = useState<FillRun[]>([]);
  const [agent, setAgent] = useState<FillRun[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const runs = await getFillRuns();
      if (!alive) return;
      setLocal(runs);
      const settings = await getAgentSettings();
      if (!settings || (await agentHealth(settings)) !== "online") return;
      await pushFillRuns(settings, runs).catch(() => {});
      const fromAgent = await fetchAgentFillRuns(settings);
      if (alive) setAgent(fromAgent);
    };
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && FILL_STATS_STORAGE_KEY in changes) void load();
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const runs = useMemo(() => (agent ? mergeFillRuns(local, agent, 2000) : local), [local, agent]);
  const summary = useMemo(() => summarizeFillRuns(runs), [runs]);

  if (runs.length === 0) return <p className="text-xs text-muted-foreground">{t("fill.empty")}</p>;

  return (
    <div className="flex flex-col gap-3">
      <FillRateChart
        days={summary.days.slice(-30)}
        totals={summary.totals}
        locale={locale}
        labels={{ extension: t("fill.extension"), fillerInAgent: t("fill.fillerInAgent"), agentFinal: t("fill.agentFinal") }}
      />
      <p className="text-xs text-muted-foreground">{agent ? t("fill.withAgent", { n: summary.runs.agent }) : t("fill.agentOff")}</p>
      {summary.misses.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">{t("fill.misses")}</span>
          <ul className="flex flex-col gap-1 text-xs">
            {summary.misses.slice(0, 5).map((m) => (
              <li key={`${m.kind}|${m.ats}|${m.outcome}`} className="flex items-baseline gap-2">
                <span className="w-6 shrink-0 text-right font-semibold tabular-nums">{m.count}</span>
                <span className="min-w-0">
                  <span className="font-medium">{m.kind}</span>
                  {m.ats && <span className="text-muted-foreground"> · {m.ats}</span>}
                  <span className="text-muted-foreground"> · {OUTCOME_LABEL[m.outcome] ? t(OUTCOME_LABEL[m.outcome]!) : m.outcome}</span>
                  {m.examples.length > 0 && <span className="block truncate text-muted-foreground">{m.examples.join(" · ")}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
