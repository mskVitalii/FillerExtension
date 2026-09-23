import { useState } from "react";
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
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      await connectGoogle();
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect Google.");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-base font-semibold">Filler</h1>
        <p className="mt-1 text-sm text-muted-foreground">Connect Google Drive</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">
          Just a Google sign-in — nothing to configure. Your profile, CV, Personal Legend and cover
          letters are stored privately in your own Google Drive, never on a server we operate.
        </p>
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Google"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      {onSkip && (
        <button onClick={onSkip} className="w-fit text-xs text-muted-foreground underline underline-offset-2">
          Skip for now
        </button>
      )}
    </div>
  );
}
