import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectGoogle } from "@/features/google-drive/auth";

interface ConnectGoogleStepProps {
  onConnected: () => void;
}

/** Second-run screen (spec sections 2, 6, 29) — one button, one developer-owned OAuth client. */
export function ConnectGoogleStep({ onConnected }: ConnectGoogleStepProps) {
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
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Check className="h-4 w-4 text-emerald-600" /> OpenAI API key saved
      </p>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm text-muted-foreground">
          Connect Google Drive to store your profile, CV, Personal Legend and cover letters — privately,
          in your own account.
        </p>
        <Button onClick={handleConnect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect Google"}
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
