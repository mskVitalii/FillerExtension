import { Check, Cloud, KeyRound } from "lucide-react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SetupBannerProps {
  googleConnected: boolean;
  hasApiKey: boolean;
  onConnectGoogle: () => void;
  onAddApiKey: () => void;
}

/**
 * Primary-styled setup checklist, replacing two separate muted-text lines.
 * Drive is listed first (spec_8): connecting it is a single free Google
 * sign-in, versus navigating OpenAI's dashboard for a paid key — and nothing
 * (autofill included) has a profile to work with until a profile can be
 * saved, which needs Drive. Renders nothing once both are done.
 */
export function SetupBanner({ googleConnected, hasApiKey, onConnectGoogle, onAddApiKey }: SetupBannerProps) {
  const t = useT();
  if (googleConnected && hasApiKey) return null;

  return (
    <Card className="border-primary/40 bg-primary/5">
      <CardContent className="flex flex-col gap-3 p-3">
        <p className="text-sm font-semibold">{t("setup.title")}</p>

        <SetupRow
          icon={Cloud}
          done={googleConnected}
          label={t("setup.drive")}
          description={t("setup.driveHint")}
          doneLabel={t("setup.connected")}
          actionLabel={t("setup.connect")}
          onAction={onConnectGoogle}
        />
        <SetupRow
          icon={KeyRound}
          done={hasApiKey}
          label={t("setup.key")}
          description={t("setup.keyHint")}
          doneLabel={t("setup.added")}
          actionLabel={t("setup.addKey")}
          onAction={onAddApiKey}
        />

        <p className="text-xs text-muted-foreground">{t("setup.autofillWorks")}</p>
      </CardContent>
    </Card>
  );
}

function SetupRow({
  icon: Icon,
  done,
  label,
  description,
  doneLabel,
  actionLabel,
  onAction,
}: {
  icon: typeof Cloud;
  done: boolean;
  label: string;
  description: string;
  doneLabel: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          done ? "bg-emerald-100 dark:bg-emerald-950/50" : "bg-primary/10",
        )}
      >
        {done ? (
          <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Icon className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {done ? (
        <span className="shrink-0 self-center text-xs font-medium text-emerald-600 dark:text-emerald-400">
          {doneLabel}
        </span>
      ) : (
        <Button size="sm" className="shrink-0 self-center" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
