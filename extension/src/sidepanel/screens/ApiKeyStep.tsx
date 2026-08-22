import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setOpenAiApiKey } from "@/features/storage/local";

interface ApiKeyStepProps {
  onSaved: () => void;
}

/** First-run screen (spec section 2): the user provides and pays for their own OpenAI key. */
export function ApiKeyStep({ onSaved }: ApiKeyStepProps) {
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
        <h1 className="text-base font-semibold">Job Application Assistant</h1>
        <p className="mt-1 text-sm text-muted-foreground">Welcome</p>
      </div>

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
    </div>
  );
}
