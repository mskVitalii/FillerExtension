import { useState } from "react";
import { useT } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { connectGoogle } from "@/features/google-drive/auth";

interface ConnectGoogleStepProps {
  onConnected: () => void;
  /** Lets a user who reached this screen from the Side Panel's setup banner
   * go back without connecting yet — extraction/autofill still work without it. */
  onSkip?: () => void;
}

/** Connects Google Drive (spec sections 2, 6, 29) — one button, one developer-owned OAuth client. */
export function ConnectGoogleStep({ onConnected, onSkip }: ConnectGoogleStepProps) {
  const [connecting, setConnecting] = useState(false);
  const t = useT();
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      await connectGoogle();
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("google.failed"));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-base font-semibold">Filler</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("setup.drive")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">
          {t("google.hint")}
        </p>
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? t("google.connecting") : t("google.connect")}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {onSkip && (
        <button onClick={onSkip} className="w-fit text-xs text-muted-foreground underline underline-offset-2">
          {t("google.skip")}
        </button>
      )}
    </div>
  );
}
