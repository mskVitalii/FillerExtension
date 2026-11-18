import type { AgentBridgeSettings } from "./client";
import { getFillRuns } from "@/features/fill-stats/repository";

/**
 * The agent's push channel (`ws://127.0.0.1:<port>/api/ws`, FillerAgent's `server/live.ts`):
 * it says when an answer was given in its dashboard (`faq`), a job changed (`job`), statistics
 * moved (`stats`) or an import finished (`context`), so the panel reacts at once instead of
 * polling. A browser WebSocket can't carry an Authorization header, so the token travels as a
 * subprotocol (`t.<token>`) next to `filler-agent`; the agent also checks the extension Origin.
 * Reconnects with backoff while the panel is open.
 */

export type AgentLiveMessage =
  | { type: "hello"; name: string; version: string }
  | { type: "job"; job: { id: string; url: string; status: string; step: string } }
  | { type: "faq" }
  | { type: "stats" }
  | { type: "context" };

export function connectAgentLive(
  settings: AgentBridgeSettings,
  handlers: { onMessage: (message: AgentLiveMessage) => void; onState: (connected: boolean) => void },
): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let delay = 2000;

  const open = () => {
    if (closed) return;
    try {
      socket = new WebSocket(`ws://127.0.0.1:${settings.port}/api/ws`, ["filler-agent", `t.${settings.token}`]);
    } catch {
      schedule();
      return;
    }
    socket.onopen = () => {
      delay = 2000;
      handlers.onState(true);
    };
    socket.onmessage = (event) => {
      try {
        handlers.onMessage(JSON.parse(String(event.data)) as AgentLiveMessage);
      } catch {
        /* not ours */
      }
    };
    socket.onclose = () => {
      handlers.onState(false);
      schedule();
    };
  };

  const schedule = () => {
    if (closed) return;
    retry = setTimeout(open, delay);
    delay = Math.min(delay * 2, 30000);
  };

  // New autofill runs go to the agent as they're recorded.
  const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== "local" || !("fillStats" in changes) || socket?.readyState !== WebSocket.OPEN) return;
    void getFillRuns().then((runs) => socket?.send(JSON.stringify({ type: "fill-runs", runs: runs.slice(-20) })));
  };
  chrome.storage.onChanged.addListener(onChanged);

  open();
  return () => {
    closed = true;
    if (retry) clearTimeout(retry);
    chrome.storage.onChanged.removeListener(onChanged);
    socket?.close();
  };
}
