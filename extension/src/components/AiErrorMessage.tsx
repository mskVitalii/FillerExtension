import { useEffect, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";
import { OPENAI_BILLING_URL, isQuotaExhaustedText, quotaErrorDetail } from "@/features/openai/errors";
import { getFallbackSettings } from "@/features/openai/fallback";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface AiErrorMessageProps {
  /** The error text as the panel got it (an `Error.message`, or a status line quoting one). */
  text: string;
  /** Classes of the plain line shown for any other error. */
  className?: string;
}

/**
 * An error line that turns into instructions when OpenAI said the account is out of credits
 * (429 `insufficient_quota`, which crosses the message channel as `OpenAiQuotaError`'s text):
 * what happened, how to add credits, a button to OpenAI billing, and OpenAI's own words below.
 * Any other error is shown as the plain line it always was.
 */
export function AiErrorMessage({ text, className = "text-xs text-destructive" }: AiErrorMessageProps) {
  if (!isQuotaExhaustedText(text)) return <p className={className}>{text}</p>;
  return <OpenAiQuotaHint detail={quotaErrorDetail(text)} />;
}

export function OpenAiQuotaHint({ detail }: { detail: string }) {
  const t = useT();
  const fallbackOff = useClaudeFallbackOff();
  return (
    <Card role="alert" className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <CardContent className="flex items-start gap-2.5 p-3">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
          <p className="font-medium">{t("quota.title")}</p>
          <p>{t("quota.steps")}</p>
          {fallbackOff && <p>{t("quota.fallbackOff", { fallback: t("fallback.title") })}</p>}
          <div>
            <Button size="sm" onClick={() => void chrome.tabs.create({ url: OPENAI_BILLING_URL })}>
              {t("quota.open")}
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>
          {detail && <p className="break-words text-muted-foreground">{t("quota.details", { detail })}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** An Anthropic key is saved but the Claude fallback is set to "Never". */
function useClaudeFallbackOff(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    let alive = true;
    void getFallbackSettings().then((settings) => {
      if (alive) setOff(settings.policy === "off" && !!settings.apiKey);
    });
    return () => {
      alive = false;
    };
  }, []);
  return off;
}
