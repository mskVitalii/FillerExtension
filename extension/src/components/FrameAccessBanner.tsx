import { useEffect, useState } from "react";
import { Frame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { sendMessage } from "@/types/messages";

interface FrameAccessBannerProps {
  tabId: number;
  /** Called after the user granted access — re-run autofill/question detection so the frame is included. */
  onGranted: () => void;
}

/**
 * Many ATS forms (Greenhouse, Lever, Workday, SmartRecruiters embeds) sit in
 * a cross-origin iframe. The activeTab grant from the toolbar click only
 * covers the top page's origin, so the content script never reaches that
 * frame and autofill finds nothing there. Rather than asking every user for
 * access to all sites up front, this offers the one origin the form is
 * embedded from, through `optional_host_permissions`. The request has to
 * run right here in the click handler: `chrome.permissions.request` needs
 * the user gesture, which wouldn't survive a hop to the background.
 */
export function FrameAccessBanner({ tabId, onGranted }: FrameAccessBannerProps) {
  const [blocked, setBlocked] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void sendMessage<{ type: "FRAME_ACCESS"; blockedOrigins: string[] }>({ type: "GET_FRAME_ACCESS", tabId })
      .then((response) => {
        if (!cancelled) setBlocked(response?.blockedOrigins ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tabId]);

  if (blocked.length === 0) return null;

  const hosts = blocked.map((origin) => new URL(origin).host);

  async function handleAllow() {
    const granted = await chrome.permissions
      .request({ origins: blocked.map((origin) => `${origin}/*`) })
      .catch(() => false);
    if (!granted) return;
    setBlocked([]);
    onGranted();
  }

  return (
    <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <CardContent className="flex items-start gap-2.5 p-3">
        <Frame className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-xs">
            Part of this page is embedded from <span className="font-medium">{hosts.join(", ")}</span>. Filler
            can't see or fill fields there until you allow access to {hosts.length === 1 ? "that site" : "those sites"}.
          </p>
          <Button size="sm" className="self-start" onClick={() => void handleAllow()}>
            Allow access
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
