import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOpenAiApiKey } from "@/features/storage/local";

interface ApiKeyStepProps {
  onSaved: () => void;
  /** Lets a user who reached this screen from the Side Panel's setup banner
   * go back without adding a key yet — autofill already works without one. */
  onSkip?: () => void;
}

/** First-run screen (spec section 2): the user provides and pays for their own OpenAI key. */
export function ApiKeyStep({ onSaved, onSkip }: ApiKeyStepProps) {
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!key.trim()) return;
    setSaving(true);
    await setOpenAiApiKey(key.trim());
    setSaving(false);
    onSaved();
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h1 className="text-base font-semibold">Filler</h1>
        <p className="mt-1 text-sm text-muted-foreground">Add your OpenAI key</p>
      </div>

      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">1.</span>
          <span>
            Open{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              platform.openai.com/api-keys
            </a>{" "}
            and sign in — or create a free account if you don't have one yet.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">2.</span>
          <span>
            Add a little credit:{" "}
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              Settings → Billing
            </a>{" "}
            → "Add payment details" → add a card, then top up e.g. <span className="font-medium">$5</span>.
            The app only uses cheap models for everything except the letter itself, so that covers
            a large number of cover letters.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">3.</span>
          <span>
            Back on the API keys page, click <span className="font-medium">"Create new secret key"</span>,
            name it something recognizable (e.g. "Filler"), then copy the value starting with{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">sk-...</code> — it's only shown once.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">4.</span>
          <span>Paste it below.</span>
        </li>
      </ol>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="openai-key" className="text-sm font-medium">
          OpenAI API Key
        </label>
        <Input
          id="openai-key"
          type="password"
          placeholder="sk-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Used directly from this extension to call OpenAI. It is never sent to any server we operate,
          and you pay OpenAI directly for your own usage.
        </p>
      </div>

      <Button onClick={handleSave} disabled={!key.trim() || saving}>
        Save Key
      </Button>

      {onSkip && (
        <button onClick={onSkip} className="w-fit text-xs text-muted-foreground underline underline-offset-2">
          Skip for now — autofill works without it
        </button>
      )}
    </div>
  );
}
