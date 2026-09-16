import { useEffect, useState } from "react";
import { ApiKeyStep } from "./screens/ApiKeyStep";
import { ApplicationsList } from "./screens/ApplicationsList";
import { ConnectGoogleStep } from "./screens/ConnectGoogleStep";
import { JobSearchPanel } from "./screens/JobSearchPanel";
import { MainView } from "./screens/MainView";
import { SettingsPanel } from "./screens/SettingsPanel";
import { useActiveTab } from "./hooks/useActiveTab";
import { getOpenAiApiKey, recordUrlActivation } from "@/features/storage/local";
import { isGoogleConnected } from "@/features/google-drive/auth";
import {
  getCandidateSummary,
  getCustomFields,
  getCvMeta,
  getFaqAnswers,
  getLanguageLevels,
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

type Step = "loading" | "api-key" | "connect-google" | "main" | "settings" | "applications" | "job-search";

/** Top-level router mirroring the first-run → main-workflow flow (spec section 2). */
export function App() {
  const [step, setStep] = useState<Step>("loading");
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [cvMeta, setCvMeta] = useState<CvMeta | null>(null);
  const [legend, setLegend] = useState("");
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [languageLevels, setLanguageLevels] = useState<LanguageLevel[]>([]);
  const [faqAnswers, setFaqAnswers] = useState<FaqEntry[]>([]);
  const [candidateSummary, setCandidateSummary] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [googleConnected, setGoogleConnected] = useState(false);
  const activeTab = useActiveTab();

  useEffect(() => {
    // spec_6 — the background only records an activation on the *icon
    // click* that opens the panel, so navigating onward inside the same tab
    // (an ATS's own "Overview" -> "Application" tab, a client-side route
    // change that never fires a new click) was invisible to the submissions
    // chart. The panel stays mounted across that navigation and
    // `useActiveTab` already re-syncs `url` on it (`chrome.tabs.onUpdated`
    // fires for History API navigation too, not just full page loads), so
    // this is the one place that sees every URL the user's session actually
    // reaches. `recordUrlActivation` is a per-URL no-op past the first call,
    // so this double-recording the panel's original URL alongside the
    // background's own call is harmless.
    if (activeTab.url) void recordUrlActivation(activeTab.url);
  }, [activeTab.url]);

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
  }

  async function loadUserData() {
    const [
      loadedProfile,
      loadedCv,
      loadedLegend,
      loadedCustomFields,
      loadedLanguageLevels,
      loadedFaqAnswers,
      loadedCandidateSummary,
    ] = await Promise.all([
      getProfile(),
      getCvMeta(),
      getPersonalLegend(),
      getCustomFields(),
      getLanguageLevels(),
      getFaqAnswers(),
      getCandidateSummary(),
    ]);
    setProfile(loadedProfile);
    setCvMeta(loadedCv);
    setLegend(loadedLegend?.content ?? "");
    setCustomFields(loadedCustomFields);
    setLanguageLevels(loadedLanguageLevels);
    setFaqAnswers(loadedFaqAnswers);
    setCandidateSummary(loadedCandidateSummary?.content ?? "");
  }

  if (step === "loading") return null;

  if (step === "api-key") {
    return (
      <ApiKeyStep
        onSaved={() => {
          setHasApiKey(true);
          setStep("main");
        }}
      />
    );
  }

  if (step === "connect-google") {
    return (
      <ConnectGoogleStep
        onConnected={() => {
          setGoogleConnected(true);
          void loadUserData();
          setStep("main");
        }}
      />
    );
  }

  if (step === "applications") {
    return <ApplicationsList onBack={() => setStep("main")} />;
  }

  if (step === "job-search") {
    return <JobSearchPanel hasApiKey={hasApiKey} onBack={() => setStep("main")} />;
  }

  if (step === "settings") {
    return (
      <SettingsPanel
        profile={profile}
        cvMeta={cvMeta}
        legendContent={legend}
        customFields={customFields}
        languageLevels={languageLevels}
        faqAnswers={faqAnswers}
        candidateSummary={candidateSummary}
        onBack={() => setStep("main")}
        onProfileChange={setProfile}
        onCvChange={setCvMeta}
        onLegendChange={setLegend}
        onCustomFieldsChange={setCustomFields}
        onLanguageLevelsChange={setLanguageLevels}
        onFaqAnswersChange={setFaqAnswers}
        onCandidateSummaryChange={setCandidateSummary}
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
      hasApiKey={hasApiKey}
      googleConnected={googleConnected}
      onOpenSettings={() => setStep("settings")}
      onOpenApplications={() => setStep("applications")}
      onOpenJobSearch={() => setStep("job-search")}
      onRequestApiKey={() => setStep("api-key")}
      onRequestGoogleConnect={() => setStep("connect-google")}
    />
  );
}
