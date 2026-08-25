import { useEffect, useState } from "react";
import { ApiKeyStep } from "./screens/ApiKeyStep";
import { ApplicationsList } from "./screens/ApplicationsList";
import { ConnectGoogleStep } from "./screens/ConnectGoogleStep";
import { MainView } from "./screens/MainView";
import { SettingsPanel } from "./screens/SettingsPanel";
import { useActiveTab } from "./hooks/useActiveTab";
import { getOpenAiApiKey } from "@/features/storage/local";
import { isGoogleConnected } from "@/features/google-drive/auth";
import {
  getCustomFields,
  getCvMeta,
  getLanguageLevels,
  getPersonalLegend,
  getProfile,
} from "@/features/profile/repository";
import { EMPTY_PROFILE, type CustomField, type CvMeta, type LanguageLevel, type Profile } from "@/types/profile";

type Step = "loading" | "api-key" | "connect-google" | "main" | "settings" | "applications";

/** Top-level router mirroring the first-run → main-workflow flow (spec section 2). */
export function App() {
  const [step, setStep] = useState<Step>("loading");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [cvMeta, setCvMeta] = useState<CvMeta | null>(null);
  const [legend, setLegend] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [languageLevels, setLanguageLevels] = useState<LanguageLevel[]>([]);
  const activeTab = useActiveTab();

  useEffect(() => {
    void bootstrap();
    // Runs once on mount only — `bootstrap` reads storage state, not props/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootstrap() {
    const apiKey = await getOpenAiApiKey();
    if (!apiKey) {
      setStep("api-key");
      return;
    }
    const connected = await isGoogleConnected();
    if (!connected) {
      setStep("connect-google");
      return;
    }
    await loadUserData();
    setStep("main");
  }

  async function loadUserData() {
    const [loadedProfile, loadedCv, loadedLegend, loadedCustomFields, loadedLanguageLevels] = await Promise.all([
      getProfile(),
      getCvMeta(),
      getPersonalLegend(),
      getCustomFields(),
      getLanguageLevels(),
    ]);
    setProfile(loadedProfile);
    setCvMeta(loadedCv);
    setLegend(loadedLegend?.content ?? "");
    setCustomFields(loadedCustomFields);
    setLanguageLevels(loadedLanguageLevels);
  }

  if (step === "loading") return null;

  if (step === "api-key") {
    return <ApiKeyStep onSaved={() => setStep("connect-google")} />;
  }

  if (step === "connect-google") {
    return (
      <ConnectGoogleStep
        onConnected={() => {
          void loadUserData();
          setStep("main");
        }}
      />
    );
  }

  if (step === "applications") {
    return <ApplicationsList onBack={() => setStep("main")} />;
  }

  if (step === "settings") {
    return (
      <SettingsPanel
        profile={profile}
        cvMeta={cvMeta}
        legendContent={legend}
        customFields={customFields}
        languageLevels={languageLevels}
        onBack={() => setStep("main")}
        onProfileChange={setProfile}
        onCvChange={setCvMeta}
        onLegendChange={setLegend}
        onCustomFieldsChange={setCustomFields}
        onLanguageLevelsChange={setLanguageLevels}
        onApiKeyDeleted={() => setStep("api-key")}
        onGoogleDisconnected={() => setStep("connect-google")}
      />
    );
  }

  if (activeTab.tabId === null) return null;

  return (
    <MainView
      key={activeTab.tabId}
      tabId={activeTab.tabId}
      tabUrl={activeTab.url ?? ""}
      profile={profile}
      cvMeta={cvMeta}
      customFields={customFields}
      languageLevels={languageLevels}
      onOpenSettings={() => setStep("settings")}
      onOpenApplications={() => setStep("applications")}
    />
  );
}
