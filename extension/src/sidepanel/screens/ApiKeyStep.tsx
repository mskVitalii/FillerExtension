import { useState } from "react";
import { useT } from "@/i18n/react";
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
  const t = useT();

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
        <p className="mt-1 text-sm text-muted-foreground">{t("setup.key")}</p>
      </div>

      <ol className="flex flex-col gap-3 text-sm">
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">1.</span>
          <span>
            {t("apiKey.step1Before")}{" "}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              platform.openai.com/api-keys
            </a>{" "}
            {t("apiKey.step1After")}
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">2.</span>
          <span>
            {t("apiKey.step2Before")}{" "}
            <a
              href="https://platform.openai.com/settings/organization/billing/overview"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              Settings → Billing
            </a>{" "}
            {t("apiKey.step2After")}
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">3.</span>
          <span>
            {t("apiKey.step3")}
          </span>
        </li>
        <li className="flex gap-2">
          <span className="shrink-0 font-medium text-muted-foreground">4.</span>
          <span>{t("apiKey.step4")}</span>
        </li>
      </ol>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="openai-key" className="text-sm font-medium">
          {t("settings.openAiKey")}
        </label>
        <Input
          id="openai-key"
          type="password"
          placeholder="sk-..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {t("apiKey.privacy")}
        </p>
      </div>

      <Button onClick={handleSave} disabled={!key.trim() || saving}>
        {t("apiKey.save")}
      </Button>

      {onSkip && (
        <button onClick={onSkip} className="w-fit text-xs text-muted-foreground underline underline-offset-2">
          {t("apiKey.skip")}
        </button>
      )}
    </div>
  );
}
