import { useEffect, useState, type ReactNode } from "react";
import { ApiKeyStep } from "./screens/ApiKeyStep";
import { ApplicationsList } from "./screens/ApplicationsList";
import { ConnectGoogleStep } from "./screens/ConnectGoogleStep";
import { CvAdaptPanel } from "./screens/CvAdaptPanel";
import { JobSearchPanel } from "./screens/JobSearchPanel";
import { MainView } from "./screens/MainView";
import { SettingsPanel } from "./screens/SettingsPanel";
import { useActiveTab } from "./hooks/useActiveTab";
import { useVisitedTabs } from "./hooks/useVisitedTabs";
import { getOpenAiApiKey } from "@/features/storage/local";
import { isGoogleConnected } from "@/features/google-drive/auth";
import { refreshDriveCaches } from "@/features/storage/drive-cache";
import {
  getCustomFields,
  getCvMeta,
  getFaqAnswers,
  getGenerationRules,
  getLanguageLevels,
  getOutreachRules,
  getPersonalLegend,
  getProfile,
} from "@/features/profile/repository";
import {
  EMPTY_PROFILE,
  type CustomField,
  type CvMeta,
  type FaqEntry,
  type LanguageLevel,
  type Profile,
} from "@/types/profile";

type Step = "loading" | "api-key" | "connect-google" | "main" | "settings" | "applications" | "job-search" | "cv-adapt";

/** Top-level router mirroring the first-run → main-workflow flow (spec section 2). */
export function App() {
  const [step, setStep] = useState<Step>("loading");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [cvMeta, setCvMeta] = useState<CvMeta | null>(null);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [languageLevels, setLanguageLevels] = useState<LanguageLevel[]>([]);
  const [faqAnswers, setFaqAnswers] = useState<FaqEntry[]>([]);
  const [personalLegend, setPersonalLegend] = useState("");
  const [generationRules, setGenerationRules] = useState("");
  const [outreachRules, setOutreachRules] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const activeTab = useActiveTab();
  const visitedTabs = useVisitedTabs(activeTab);

  useEffect(() => {
    void bootstrap();
    // Runs once on mount only — `bootstrap` reads storage state, not props/state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Job extraction (DOM/JSON-LD, in MainView) needs neither an OpenAI key nor
  // a Drive connection, so bootstrap no longer blocks on either — it only
  // records their state so MainView can prompt for them when an action that
  // actually needs them (cover letter generation, Drive save) is used.
  async function bootstrap() {
    const apiKey = await getOpenAiApiKey();
    setHasApiKey(Boolean(apiKey));
    const connected = await isGoogleConnected();
    setGoogleConnected(connected);
    await loadUserData();
    setStep("main");
    // The panel opens on the local caches; then pull what another browser
    // saved to Drive since, and reload only if something actually changed.
    if (connected) void syncFromDrive();
  }

  async function syncFromDrive() {
    if (await refreshDriveCaches()) await loadUserData();
  }

  async function loadUserData() {
    const [
      loadedProfile,
      loadedCv,
      loadedCustomFields,
      loadedLanguageLevels,
      loadedFaqAnswers,
      loadedPersonalLegend,
      loadedGenerationRules,
      loadedOutreachRules,
    ] = await Promise.all([
      getProfile(),
      getCvMeta(),
      getCustomFields(),
      getLanguageLevels(),
      getFaqAnswers(),
      getPersonalLegend(),
      getGenerationRules(),
      getOutreachRules(),
    ]);
    setProfile(loadedProfile);
    setCvMeta(loadedCv);
    setCustomFields(loadedCustomFields);
    setLanguageLevels(loadedLanguageLevels);
    setFaqAnswers(loadedFaqAnswers);
    setPersonalLegend(loadedPersonalLegend?.content ?? "");
    setGenerationRules(loadedGenerationRules?.content ?? "");
    setOutreachRules(loadedOutreachRules?.content ?? "");
  }

  if (step === "loading") return null;

  let screen: ReactNode = null;

  if (step === "api-key") {
    screen = (
      <ApiKeyStep
        onSaved={() => {
          setHasApiKey(true);
          setStep("main");
        }}
        onSkip={() => setStep("main")}
      />
    );
  }

  if (step === "connect-google") {
    screen = (
      <ConnectGoogleStep
        onConnected={() => {
          setGoogleConnected(true);
          // Caches written before connecting may predate this Drive's data (e.g. a new browser).
          void refreshDriveCaches().then(loadUserData);
          setStep("main");
        }}
        onSkip={() => setStep("main")}
      />
    );
  }

  if (step === "applications") {
    screen = <ApplicationsList onBack={() => setStep("main")} />;
  }

  if (step === "job-search") {
    screen = (
      <JobSearchPanel
        hasApiKey={hasApiKey}
        personalLegend={personalLegend}
        onBack={() => setStep("main")}
        onOpenSettings={() => setStep("settings")}
      />
    );
  }

  if (step === "cv-adapt" && activeTab.tabId !== null) {
    screen = (
      <CvAdaptPanel
        key={activeTab.tabId}
        tabId={activeTab.tabId}
        tabUrl={activeTab.url ?? ""}
        profile={profile}
        hasApiKey={hasApiKey}
        onBack={() => setStep("main")}
        onRequestApiKey={() => setStep("api-key")}
        onCvChange={setCvMeta}
      />
    );
  }

  if (step === "settings") {
    screen = (
      <SettingsPanel
        profile={profile}
        cvMeta={cvMeta}
        customFields={customFields}
        languageLevels={languageLevels}
        faqAnswers={faqAnswers}
        generationRules={generationRules}
        outreachRules={outreachRules}
        onBack={() => setStep("main")}
        onProfileChange={setProfile}
        onCvChange={setCvMeta}
        onCustomFieldsChange={setCustomFields}
        onLanguageLevelsChange={setLanguageLevels}
        onFaqAnswersChange={setFaqAnswers}
        onPersonalLegendChange={setPersonalLegend}
        onGenerationRulesChange={setGenerationRules}
        onOutreachRulesChange={setOutreachRules}
        onApiKeyDeleted={() => {
          setHasApiKey(false);
          setStep("api-key");
        }}
        onGoogleDisconnected={() => {
          setGoogleConnected(false);
          setStep("connect-google");
        }}
      />
    );
  }

  // One MainView per visited tab, all kept mounted — only the active tab's is shown, and none
  // while another screen is open — so leaving a tab (or opening Settings) never aborts its work.
  return (
    <>
      {visitedTabs.map((tab) => {
        const shown = step === "main" && tab.tabId === activeTab.tabId;
        return (
          <div key={tab.tabId} hidden={!shown}>
            <MainView
              tabId={tab.tabId}
              tabUrl={tab.url}
              active={shown}
              profile={profile}
              cvMeta={cvMeta}
              customFields={customFields}
              languageLevels={languageLevels}
              hasApiKey={hasApiKey}
              googleConnected={googleConnected}
              onOpenSettings={() => setStep("settings")}
              onOpenApplications={() => setStep("applications")}
              onOpenJobSearch={() => setStep("job-search")}
              onOpenCvAdapt={() => setStep("cv-adapt")}
              onRequestApiKey={() => setStep("api-key")}
              onRequestGoogleConnect={() => setStep("connect-google")}
              onCvChange={setCvMeta}
            />
          </div>
        );
      })}
      {screen}
    </>
  );
}
