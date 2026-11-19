import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CLAUDE_MODELS, CLAUDE_MODEL_MAIN, CLAUDE_MODEL_SUPPORT } from "@/features/openai/anthropic";
import { AI_FALLBACK_POLICIES, getFallbackSettings, type AiFallbackPolicy } from "@/features/openai/fallback";
import { setAnthropicApiKey } from "@/features/storage/local";
import { setPreferences } from "@/features/storage/sync";
import { useT } from "@/i18n/react";
import type { MessageKey } from "@/i18n/messages/en";

const POLICY_LABEL: Record<AiFallbackPolicy, MessageKey> = {
  off: "fallback.policyOff",
  unavailable: "fallback.policyUnavailable",
  any: "fallback.policyAny",
  always: "fallback.policyAlways",
};

/** Last characters of a stored key, never the key itself. */
function keyHint(key: string): string {
  return key ? `…${key.slice(-4)}` : "";
}

/**
 * Settings → "Fallback to Claude": the Anthropic key (chrome.storage.local, like the OpenAI one),
 * when to use it, and which Claude model answers for each tier.
 */
export function AiFallbackSettings() {
  const t = useT();
  const [policy, setPolicy] = useState<AiFallbackPolicy>("unavailable");
  const [mainModel, setMainModel] = useState(CLAUDE_MODEL_MAIN);
  const [supportModel, setSupportModel] = useState(CLAUDE_MODEL_SUPPORT);
  const [storedHint, setStoredHint] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getFallbackSettings().then((settings) => {
      setPolicy(settings.policy);
      setMainModel(settings.models.main);
      setSupportModel(settings.models.support);
      setStoredHint(keyHint(settings.apiKey));
    });
  }, []);

  async function saveKey(value: string) {
    setSaving(true);
    try {
      await setAnthropicApiKey(value.trim());
      setStoredHint(keyHint(value.trim()));
      setKeyDraft("");
    } finally {
      setSaving(false);
    }
  }

  const modelOptions = (selected: string) =>
    (CLAUDE_MODELS as readonly string[]).includes(selected) ? [...CLAUDE_MODELS] : [selected, ...CLAUDE_MODELS];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("fallback.title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">{t("fallback.hint")}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="anthropic-key" className="text-xs text-muted-foreground">
            {t("fallback.apiKey")}
          </label>
          <div className="flex gap-2">
            <Input
              id="anthropic-key"
              type="password"
              autoComplete="off"
              placeholder={storedHint ? t("fallback.apiKeyStored", { hint: storedHint }) : "sk-ant-…"}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <Button size="sm" variant="outline" disabled={saving || !keyDraft.trim()} onClick={() => void saveKey(keyDraft)}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
          {storedHint && (
            <button type="button" className="w-fit text-[11px] text-muted-foreground underline" onClick={() => void saveKey("")}>
              {t("fallback.removeKey")}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fallback-policy" className="text-xs text-muted-foreground">
            {t("fallback.policy")}
          </label>
          <Select
            id="fallback-policy"
            value={policy}
            onChange={(e) => {
              const next = e.target.value as AiFallbackPolicy;
              setPolicy(next);
              void setPreferences({ aiFallbackPolicy: next });
            }}
          >
            {AI_FALLBACK_POLICIES.map((value) => (
              <option key={value} value={value}>
                {t(POLICY_LABEL[value])}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="claude-main" className="text-xs text-muted-foreground">
            {t("fallback.modelMain")}
          </label>
          <Select
            id="claude-main"
            value={mainModel}
            onChange={(e) => {
              setMainModel(e.target.value);
              void setPreferences({ claudeMainModel: e.target.value });
            }}
          >
            {modelOptions(mainModel).map((model) => (
              <option key={model} value={model}>
                {model === CLAUDE_MODEL_MAIN ? t("settings.modelDefault", { model }) : model}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="claude-support" className="text-xs text-muted-foreground">
            {t("fallback.modelSupport")}
          </label>
          <Select
            id="claude-support"
            value={supportModel}
            onChange={(e) => {
              setSupportModel(e.target.value);
              void setPreferences({ claudeSupportModel: e.target.value });
            }}
          >
            {modelOptions(supportModel).map((model) => (
              <option key={model} value={model}>
                {model === CLAUDE_MODEL_SUPPORT ? t("settings.modelDefault", { model }) : model}
              </option>
            ))}
          </Select>
        </div>
        {policy !== "off" && !storedHint && <p className="text-[11px] text-muted-foreground">{t("fallback.needsKey")}</p>}
      </CardContent>
    </Card>
  );
}
