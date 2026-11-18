import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import type { Job } from "@/types/job";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  requestAgentPermission,
  saveAgentSettings,
  type AgentBridgeSettings,
  type AgentCheck,
  type AgentHealth,
} from "@/features/agent-bridge/client";
import { SYNCED_CACHE_KEYS, lastAgentSync, syncWithAgent } from "@/features/agent-bridge/sync";

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
export function AgentApplyButton({ job, url }: { job: Job; url: string }) {
  const t = useT();
  const [settings, setSettings] = useState<AgentBridgeSettings | null>(null);
  const [health, setHealth] = useState<AgentHealth>("offline");
  const [check, setCheck] = useState<AgentCheck | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [token, setToken] = useState("");
  const [port, setPort] = useState(String(DEFAULT_AGENT_PORT));
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getAgentSettings().then(setSettings);
    void lastAgentSync().then(setSyncedAt);
  }, []);

  const sync = useCallback(
    async (force = false): Promise<boolean> => {
      if (!settings) return false;
      setSyncing(true);
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
    const next = await agentHealth(settings);
    setHealth(next);
    if (next !== "online" || !url || !job.position) {
      setCheck(null);
      return;
    }
    try {
      setCheck(await checkWithAgent(settings, url, job));
    } catch {
      setCheck(null);
    }
  }, [settings, url, job]);

  useEffect(() => {
    if (!settings) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => clearInterval(timer);
  }, [settings, refresh]);

  // First sync once the agent is reachable (panel open, agent started later, reconnect).
  const online = health === "online";
  useEffect(() => {
    if (online) void sync();
  }, [online, sync]);

  // Re-sync a few seconds after the user's data changes (profile, CVs, legends, FAQ, rules, …).
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!online) return;
    const watched = new Set<string>(SYNCED_CACHE_KEYS);
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !Object.keys(changes).some((key) => watched.has(key))) return;
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
    void granted.then(async (ok) => {
      if (!ok) {
        setMessage(t("agent.notGranted"));
        return;
      }
      const next = { token: token.trim(), port: Number(port) || DEFAULT_AGENT_PORT };
      await saveAgentSettings(next);
      setSettings(next);
      setConnecting(false);
      setMessage(null);
    });
  };

  const apply = async () => {
    if (!settings) return;
    setSending(true);
    setMessage(null);
    try {
      // Sync first, then use: the agent must apply with the data as it is now.
      if (!(await sync(true))) return;
      const created = await applyViaAgent(settings, url, job);
      setMessage(t("agent.queued", { status: created.status }));
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (!settings || connecting) {
    if (!connecting) {
      return (
        <button type="button" className="self-start text-xs text-muted-foreground underline" onClick={() => setConnecting(true)}>
          {t("agent.connectLink")}
        </button>
      );
    }
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-2 text-xs">
        <span className="text-muted-foreground">{t("agent.tokenHint")}</span>
        <div className="flex gap-2">
          <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder={t("agent.tokenPlaceholder")} className="h-8 flex-1" />
          <Input value={port} onChange={(e) => setPort(e.target.value)} className="h-8 w-20" inputMode="numeric" aria-label={t("agent.port")} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={connect} disabled={!token.trim()}>
            {t("agent.connect")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConnecting(false)}>
            {t("common.cancel")}
          </Button>
        </div>
        {message && <span className="text-destructive">{message}</span>}
      </div>
    );
  }

  const existing = check?.existingJob;
  const reasons = check && !check.eligible ? check.reasons : [];
  const enabled = online && Boolean(check?.eligible) && !sending;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Button className="flex-auto" variant="outline" onClick={() => void apply()} disabled={!enabled} title={reasons.join("\n") || undefined}>
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
          <button type="button" className="underline" onClick={() => setConnecting(true)}>
            {t("agent.reconnect")}
          </button>
        )}
      </div>
      {syncError && <span className="text-xs text-destructive">{syncError}</span>}
      {existing && <span className="text-xs text-muted-foreground">{t("agent.existing", { status: existing.status, step: existing.step })}</span>}
      {!existing && reasons.length > 0 && <span className="text-xs text-muted-foreground">{reasons[0]}</span>}
      {message && <span className="text-xs text-muted-foreground">{message}</span>}
    </div>
  );
}
