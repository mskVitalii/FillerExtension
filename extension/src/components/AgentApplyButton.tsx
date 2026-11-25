import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { baseStorageKey } from "@/features/projects/registry";
import { PICKER_GRADIENT } from "@/lib/brand-gradient";
import { Bot, Loader2 } from "lucide-react";
import type { Job } from "@/types/job";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/react";
import type { MessageKey } from "@/i18n/core";
import {
  DEFAULT_AGENT_PORT,
  agentDashboardUrl,
  agentHealth,
  applyViaAgent,
  checkWithAgent,
  getAgentSettings,
  isLinkedInUrl,
  pairWithAgent,
  requestAgentPermission,
  type AgentBridgeSettings,
  type AgentCheck,
  type AgentHealth,
} from "@/features/agent-bridge/client";
import { SYNCED_CACHE_KEYS, lastAgentSync, syncWithAgent } from "@/features/agent-bridge/sync";
import { connectAgentLive } from "@/features/agent-bridge/live";
import { sendMessage, type MessageOf } from "@/types/messages";

/** Polling only stands in for the push channel: often while it's down, rarely as a safety net. */
const POLL_MS = { live: 5 * 60 * 1000, fallback: 15000 };

const HEALTH_LABEL: Record<AgentHealth, MessageKey> = {
  online: "agent.online",
  offline: "agent.offline",
  unauthorized: "agent.unauthorized",
  "no-permission": "agent.noPermission",
};

/** Sync this long after the last change to the user's data, so a burst of edits sends one upload. */
const SYNC_DEBOUNCE_MS = 5000;

function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Experimental: hands the current posting to the local Filler agent, which
 * applies on its own Chrome (test mode unless enabled in the agent's config).
 * Enabled only while the agent answers and says the posting meets its
 * criteria. While paired it keeps the agent's copy of the user's data current
 * (`agent-bridge/sync.ts`): on panel open, after local changes, and always
 * right before handing over a posting.
 */
export function AgentApplyButton({ job, url: tabUrl, tabId }: { job: Job; url: string; tabId?: number }) {
  const t = useT();
  // On LinkedIn the agent gets the employer's own link behind the "Apply ↗" button (read from the
  // page, never clicked), not the LinkedIn page: it applies on the employer's site and must never
  // open LinkedIn. Re-read when the selected job changes (URL) or its pane finishes loading (title).
  const onLinkedIn = isLinkedInUrl(tabUrl);
  const [employer, setEmployer] = useState<{ for: string; url: string } | null>(null);
  useEffect(() => {
    if (!onLinkedIn || tabId === undefined) return;
    let cancelled = false;
    sendMessage<MessageOf<"LINKEDIN_APPLY_URL">>({ type: "GET_LINKEDIN_APPLY_URL", tabId })
      .then((reply) => !cancelled && setEmployer({ for: tabUrl, url: reply?.url ?? "" }))
      .catch(() => !cancelled && setEmployer({ for: tabUrl, url: "" }));
    return () => {
      cancelled = true;
    };
  }, [onLinkedIn, tabId, tabUrl, job.position]);
  const linkedInResolved = onLinkedIn && employer?.for === tabUrl;
  const url = onLinkedIn ? (linkedInResolved ? employer.url : "") : tabUrl;
  const targetJob = useMemo(() => (onLinkedIn && url ? { ...job, url } : job), [onLinkedIn, url, job]);
  const [settings, setSettings] = useState<AgentBridgeSettings | null>(null);
  const [health, setHealth] = useState<AgentHealth>("offline");
  const [check, setCheck] = useState<AgentCheck | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    void getAgentSettings().then(setSettings);
    void lastAgentSync().then(setSyncedAt);
  }, []);

  const sync = useCallback(
    async (force = false, quiet = false): Promise<boolean> => {
      if (!settings) return false;
      if (!quiet) setSyncing(true);
      try {
        const result = await syncWithAgent(settings, { force });
        setSyncedAt(result.syncedAt);
        setSyncError(result.outcome === "skipped" ? (result.message ?? null) : null);
        return true;
      } catch (err) {
        setSyncError(t("agent.syncFailed", { error: (err as Error).message }));
        return false;
      } finally {
        setSyncing(false);
      }
    },
    [settings, t],
  );

  const refresh = useCallback(async () => {
    if (!settings) return;
    let next = await agentHealth(settings);
    // The agent's token changed (new install, config reset): pair again, no click needed.
    if (next === "unauthorized") {
      try {
        setSettings(await pairWithAgent(settings.port));
        return;
      } catch {
        /* stays "unauthorized" */
      }
      next = "unauthorized";
    }
    setHealth(next);
    if (next !== "online" || !url || !targetJob.position) {
      setCheck(null);
      return;
    }
    try {
      setCheck(await checkWithAgent(settings, url, targetJob));
    } catch {
      setCheck(null);
    }
  }, [settings, url, targetJob]);

  useEffect(() => {
    if (!settings) return;
    void refresh();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      live ? POLL_MS.live : POLL_MS.fallback,
    );
    return () => clearInterval(timer);
  }, [settings, refresh, live]);

  // First sync once the agent is reachable (panel open, agent started later, reconnect).
  const online = health === "online";
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  // Answers given in the agent's dashboard come over at once (`faq` on the push channel); a job of
  // this posting changing refreshes the button. Polling remains as the fallback.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    if (!online || !settings) return;
    return connectAgentLive(settings, {
      onState: setLive,
      onMessage: (m) => {
        if (m.type === "faq") void syncRef.current(false, true);
        if (m.type === "job" && m.job.url === url) void refreshRef.current();
      },
    });
  }, [online, settings, url]);
  useEffect(() => {
    if (!online) return;
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void sync(false, true);
      },
      live ? POLL_MS.live : POLL_MS.fallback,
    );
    return () => clearInterval(timer);
  }, [online, sync, live]);

  // Re-sync a few seconds after the user's data changes (profile, CVs, legends, FAQ, rules, …).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!online) return;
    const watched = new Set<string>(SYNCED_CACHE_KEYS);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !Object.keys(changes).some((key) => watched.has(baseStorageKey(key)))) return;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => void sync(), SYNC_DEBOUNCE_MS);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [online, sync]);

  useEffect(() => {
    setMessage(null);
  }, [url]);

  const connect = () => {
    // No await before this: the permission prompt needs the click's user gesture.
    const granted = requestAgentPermission();
    setConnecting(true);
    setMessage(null);
    void granted
      .then(async (ok) => {
        if (!ok) {
          setMessage(t("agent.notGranted"));
          return;
        }
        setSettings(await pairWithAgent(settings?.port ?? DEFAULT_AGENT_PORT));
      })
      .catch((err: Error) => setMessage(err.message === "offline" ? t("agent.notRunning") : err.message))
      .finally(() => setConnecting(false));
  };

  const apply = async () => {
    if (!settings) return;
    setSending(true);
    setMessage(null);
    try {
      // Sync first, then use: the agent must apply with the data as it is now.
      if (!(await sync(true))) return;
      const created = await applyViaAgent(settings, url, targetJob);
      setMessage(t("agent.queued", { status: created.status }));
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex flex-col gap-1">
        <button type="button" className="self-start text-xs text-muted-foreground underline disabled:opacity-50" onClick={connect} disabled={connecting}>
          {connecting ? t("agent.connecting") : t("agent.connectLink")}
        </button>
        {message && <span className="text-xs text-destructive">{message}</span>}
      </div>
    );
  }

  const existing = check?.existingJob;
  const reasons = check && !check.eligible ? check.reasons : [];
  const enabled = online && Boolean(check?.eligible) && !sending;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button
          className="flex-auto border-0 text-white hover:text-white hover:opacity-90"
          style={{ background: PICKER_GRADIENT }}
          variant="outline"
          onClick={() => void apply()}
          disabled={!enabled}
          title={reasons.join("\n") || undefined}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          {t("agent.apply")}
        </Button>
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full",
            online ? "bg-green-500" : health === "offline" ? "bg-muted-foreground/40" : "bg-amber-500",
          )}
          title={t(HEALTH_LABEL[health])}
          aria-label={t(HEALTH_LABEL[health])}
          role="status"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span>{t(HEALTH_LABEL[health])}</span>
        {online && (
          <a href={agentDashboardUrl(settings)} target="_blank" rel="noreferrer" className="underline">
            {t("agent.dashboard")}
          </a>
        )}
        {online &&
          (syncing ? (
            <span>{t("agent.syncing")}</span>
          ) : (
            <>
              {syncedAt && <span>{t("agent.syncedAt", { time: timeLabel(syncedAt) })}</span>}
              <button type="button" className="underline" onClick={() => void sync(true)}>
                {t("agent.syncNow")}
              </button>
            </>
          ))}
        {(health === "unauthorized" || health === "no-permission") && (
          <button type="button" className="underline" onClick={connect}>
            {t("agent.reconnect")}
          </button>
        )}
      </div>
      {linkedInResolved && url && <span className="text-xs text-muted-foreground">{t("agent.linkedinEmployer", { host: new URL(url).hostname })}</span>}
      {linkedInResolved && !url && <span className="text-xs text-muted-foreground">{t("agent.linkedinNoLink")}</span>}
      {syncError && <span className="text-xs text-destructive">{syncError}</span>}
      {existing && <span className="text-xs text-muted-foreground">{t("agent.existing", { status: existing.status, step: existing.step })}</span>}
      {!existing && reasons.length > 0 && <span className="text-xs text-muted-foreground">{reasons[0]}</span>}
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
