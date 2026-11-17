import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Loader2, Mail, Send, Trash2, X } from "lucide-react";
import { downloadFile } from "@/features/pdf/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CvLibraryItem } from "@/components/CvLibraryItem";
import { RulesEditor } from "@/components/RulesEditor";
import { FaqAnswerBubble, FaqChatDivider, FaqQuestionBubble } from "@/components/FaqChat";
import { useI18n } from "@/i18n/react";
import { LOCALES, LOCALE_NAMES, detectLocale, type UiLanguagePreference } from "@/i18n/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  EMPTY_PROFILE,
  SALUTATION_OPTIONS,
  PRONOUN_OPTIONS,
  type CustomField,
  type CvMeta,
  type CvSettings,
  type FaqEntry,
  type LanguageLevel,
  type LegendMeta,
  type Profile,
} from "@/types/profile";
import { CEFR_LEVELS } from "@/lib/language-level";
import {
  createLegend,
  deleteCv,
  deleteLegend,
  getCvFile,
  getCvLibrary,
  getGenerationRules,
  getLegendLibrary,
  getOutreachRules,
  saveCustomFields,
  saveFaqAnswers,
  saveGenerationRules,
  saveLanguageLevels,
  saveOutreachRules,
  saveProfile,
  setActiveCv,
  setActiveLegend,
  updateCvSettings,
  updateLegendContent,
  uploadCv,
  uploadLegendFile,
} from "@/features/profile/repository";
import { disconnectGoogle } from "@/features/google-drive/auth";
import {
  AVAILABLE_MODELS,
  MODEL_LUNA,
  MODEL_TERRA,
  listAvailableModels,
  resolveModel,
} from "@/features/openai/client";
import {
  deleteOpenAiApiKey,
  getJobSearchCredentials,
  setJobSearchCredentials,
  type JobSearchCredentials,
} from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { CV_FILE_ACCEPT, prepareCvFile } from "@/lib/cv-text";
import { COUNTRIES } from "@/lib/countries";
import { formatSalaryForStorage } from "@/lib/salary";
import { FAQ_QUESTIONS } from "@/lib/faq-questions";
import { LANGUAGES } from "@/lib/languages";
import { sendMessage } from "@/types/messages";

/** Grouped once at module load — `FAQ_QUESTIONS` is a fixed constant, not per-render state. */
const FAQ_GROUPS = Object.entries(
  FAQ_QUESTIONS.reduce<Record<string, typeof FAQ_QUESTIONS>>((groups, q) => {
    (groups[q.category] ??= []).push(q);
    return groups;
  }, {}),
);

interface SettingsPanelProps {
  profile: Profile;
  cvMeta: CvMeta | null;
  customFields: CustomField[];
  languageLevels: LanguageLevel[];
  faqAnswers: FaqEntry[];
  generationRules: string;
  outreachRules: string;
  onBack: () => void;
  onProfileChange: (profile: Profile) => void;
  onCvChange: (cvMeta: CvMeta | null) => void;
  onCustomFieldsChange: (fields: CustomField[]) => void;
  onLanguageLevelsChange: (levels: LanguageLevel[]) => void;
  onFaqAnswersChange: (entries: FaqEntry[]) => void;
  /** Fires whenever the active Personal Legend's content changes (upload, manual create, switch, edit) — mirrors it into App-level state so the Job Search preview (spec_8 item 8) stays in sync without a full reload. */
  onPersonalLegendChange: (content: string) => void;
  onGenerationRulesChange: (content: string) => void;
  onOutreachRulesChange: (content: string) => void;
  onApiKeyDeleted: () => void;
  onGoogleDisconnected: () => void;
}

export function SettingsPanel({
  profile,
  cvMeta,
  customFields,
  languageLevels,
  faqAnswers,
  generationRules,
  outreachRules,
  onBack,
  onProfileChange,
  onCvChange,
  onCustomFieldsChange,
  onLanguageLevelsChange,
  onFaqAnswersChange,
  onPersonalLegendChange,
  onGenerationRulesChange,
  onOutreachRulesChange,
  onApiKeyDeleted,
  onGoogleDisconnected,
}: SettingsPanelProps) {
  const { t, setPreference: applyUiLanguage } = useI18n();
  const [uiLanguage, setUiLanguage] = useState<UiLanguagePreference>("auto");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cvUploadError, setCvUploadError] = useState<string | null>(null);
  const [cvList, setCvList] = useState<CvMeta[]>([]);
  const [switchingCvId, setSwitchingCvId] = useState<string | null>(null);

  const legendFileInputRef = useRef<HTMLInputElement>(null);
  const [legendList, setLegendList] = useState<LegendMeta[]>([]);
  const [activeLegendId, setActiveLegendId] = useState<string | null>(null);
  const [switchingLegendId, setSwitchingLegendId] = useState<string | null>(null);
  const [uploadingLegend, setUploadingLegend] = useState(false);
  const [addingLegend, setAddingLegend] = useState(false);
  const [newLegendName, setNewLegendName] = useState("");
  const [legendContentDraft, setLegendContentDraft] = useState("");
  const [savingLegendContent, setSavingLegendContent] = useState(false);

  const [autofillOnOpen, setAutofillOnOpen] = useState(true);
  const [autoSelectCv, setAutoSelectCv] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [aiChooseCv, setAiChooseCv] = useState(false);
  const [coverLetterModel, setCoverLetterModel] = useState<string>(MODEL_TERRA);
  const [extractionModel, setExtractionModel] = useState<string>(MODEL_LUNA);
  const [jobAnalysisModel, setJobAnalysisModel] = useState<string>(MODEL_LUNA);
  const [supportModel, setSupportModel] = useState<string>(MODEL_LUNA);
  const [outreachModel, setOutreachModel] = useState<string>(MODEL_TERRA);
  const [modelOptions, setModelOptions] = useState<string[]>([...AVAILABLE_MODELS]);
  const [fieldsDraft, setFieldsDraft] = useState(customFields);
  const [savingFields, setSavingFields] = useState(false);
  const [languagesDraft, setLanguagesDraft] = useState(languageLevels);
  const [savingLanguages, setSavingLanguages] = useState(false);
  const [faqDraft, setFaqDraft] = useState<Record<string, string>>(
    Object.fromEntries(
      faqAnswers.filter((e) => !e.id).map((e) => [e.question, e.answer]),
    ),
  );
  const [customFaqDraft, setCustomFaqDraft] = useState<FaqEntry[]>(
    faqAnswers.filter((e) => e.id),
  );
  const [generatingFaq, setGeneratingFaq] = useState(false);
  const [faqError, setFaqError] = useState<string | null>(null);
  const [savingFaq, setSavingFaq] = useState(false);
  const faqDialogRef = useRef<HTMLDialogElement>(null);
  const faqAnsweredCount = FAQ_QUESTIONS.filter(({ question }) => faqDraft[question]?.trim()).length;
  const [jobSearchCreds, setJobSearchCreds] = useState<JobSearchCredentials>({
    tavilyApiKey: "",
    adzunaAppId: "",
    adzunaAppKey: "",
  });
  const [savingJobSearchCredentials, setSavingJobSearchCredentials] = useState(false);
  const [profileSaveNotice, setProfileSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    void getJobSearchCredentials().then(setJobSearchCreds);
  }, []);

  useEffect(() => {
    void getCvLibrary().then((library) => setCvList(library.items));
  }, []);

  useEffect(() => {
    void getLegendLibrary().then((library) => {
      setLegendList(library.items);
      setActiveLegendId(library.activeId);
      const active = library.items.find((legend) => legend.id === library.activeId);
      setLegendContentDraft(active?.content ?? "");
    });
  }, []);

  useEffect(() => {
    void getPreferences().then((prefs) => {
      setAutofillOnOpen(prefs.autofillOnOpen);
      setUiLanguage(prefs.uiLanguage);
      setAutoSelectCv(prefs.autoSelectCv);
      setAiChooseCv(prefs.aiChooseCv);
      setCoverLetterModel(resolveModel(prefs.coverLetterModel, MODEL_TERRA));
      setExtractionModel(resolveModel(prefs.extractionModel, MODEL_LUNA));
      setJobAnalysisModel(resolveModel(prefs.jobAnalysisModel, MODEL_LUNA));
      setSupportModel(resolveModel(prefs.supportModel, MODEL_LUNA));
      setOutreachModel(resolveModel(prefs.outreachModel, MODEL_TERRA));
      // A model id saved by an older version (e.g. the retired gpt-5.6-* ones) is already
      // ignored at request time; reset it to "" so the tier follows its default from now on.
      const modelKeys = ["coverLetterModel", "extractionModel", "jobAnalysisModel", "supportModel", "outreachModel"] as const;
      const stale = modelKeys.filter((key) => prefs[key] && resolveModel(prefs[key], "") === "");
      if (stale.length > 0) void setPreferences(Object.fromEntries(stale.map((key) => [key, ""])));
    });
    void listAvailableModels().then(setModelOptions);
  }, []);

  /** Options for one tier's selector, keeping the current choice listed even if this key's model list lacks it. */
  function renderModelOptions(selected: string, tierDefault: string) {
    const models = modelOptions.includes(selected) ? modelOptions : [selected, ...modelOptions];
    return models.map((model) => (
      <option key={model} value={model}>
        {model === tierDefault ? t("settings.modelDefault", { model }) : model}
      </option>
    ));
  }

  async function handleUiLanguageChange(preference: UiLanguagePreference) {
    setUiLanguage(preference);
    applyUiLanguage(preference);
    await setPreferences({ uiLanguage: preference });
  }

  async function handleToggleAutofillOnOpen(checked: boolean) {
    setAutofillOnOpen(checked);
    await setPreferences({ autofillOnOpen: checked });
  }

  async function handleCoverLetterModelChange(model: string) {
    setCoverLetterModel(model);
    await setPreferences({ coverLetterModel: model });
  }

  async function handleExtractionModelChange(model: string) {
    setExtractionModel(model);
    await setPreferences({ extractionModel: model });
  }

  async function handleJobAnalysisModelChange(model: string) {
    setJobAnalysisModel(model);
    await setPreferences({ jobAnalysisModel: model });
  }

  async function handleSupportModelChange(model: string) {
    setSupportModel(model);
    await setPreferences({ supportModel: model });
  }

  async function handleOutreachModelChange(model: string) {
    setOutreachModel(model);
    await setPreferences({ outreachModel: model });
  }

  async function handleCvSelected(rawFile: File) {
    setUploading(true);
    setCvUploadError(null);
    try {
      // Any CV with {{placeholders}} typed in is also a ready template for the Adapt CV tab; a
      // LaTeX project is compiled here once, for its text and for plain "Attach CV".
      const prepared = await prepareCvFile(rawFile);
      const meta = await uploadCv(prepared.file, prepared.text, prepared.pdf);
      setCvList((list) => [...list, meta]);
      onCvChange(meta);
    } catch (err) {
      setCvUploadError(err instanceof Error ? err.message : t("settings.cvUploadFailed"));
    } finally {
      setUploading(false);
    }
  }

  async function handleSetActiveCv(id: string) {
    setSwitchingCvId(id);
    try {
      const meta = await setActiveCv(id);
      onCvChange(meta);
    } finally {
      setSwitchingCvId(null);
    }
  }

  async function handleExportData() {
    setExporting(true);
    setExportNotice(null);
    try {
      const { buildExport } = await import("@/features/export/data-export");
      const result = await buildExport();
      await downloadFile(new File([result.zip as Uint8Array<ArrayBuffer>], result.fileName, { type: "application/zip" }));
      const { counts, warnings } = result.manifest;
      setExportNotice(
        t("settings.exported", { cvs: counts.cvs, legends: counts.legends, applications: counts.applications }) +
          (warnings.length > 0
            ? " " + t("settings.exportWarnings", { count: warnings.length, list: warnings.slice(0, 3).join("; ") + (warnings.length > 3 ? "…" : "") })
            : ""),
      );
    } catch (err) {
      setExportNotice(t("settings.exportFailed", { error: err instanceof Error ? err.message : "" }));
    } finally {
      setExporting(false);
    }
  }

  async function handleDownloadCv(id: string) {
    setCvUploadError(null);
    try {
      const file = await getCvFile(id);
      if (!file) throw new Error(t("settings.cvDownloadMissing"));
      await downloadFile(file);
    } catch (err) {
      setCvUploadError(err instanceof Error ? err.message : String(err));
    }
  }

  /** The saved legend as a file; the name gets `.md` unless it already ends in an extension. */
  async function handleDownloadLegend(legend: LegendMeta) {
    const base = (legend.name || t("settings.untitledLegend")).trim();
    const fileName = /\.[a-z0-9]{1,5}$/i.test(base) ? base : `${base}.md`;
    await downloadFile(new File([legend.content], fileName, { type: "text/markdown" }));
  }

  async function handleSaveCvSettings(id: string, settings: CvSettings) {
    const library = await updateCvSettings(id, settings);
    setCvList(library.items);
    const active = library.items.find((cv) => cv.id === cvMeta?.id);
    if (active) onCvChange(active);
  }

  async function handleCvSelectionPreference(patch: { autoSelectCv?: boolean; aiChooseCv?: boolean }) {
    if (patch.autoSelectCv !== undefined) setAutoSelectCv(patch.autoSelectCv);
    if (patch.aiChooseCv !== undefined) setAiChooseCv(patch.aiChooseCv);
    await setPreferences(patch);
  }

  async function handleDeleteCv(id: string) {
    await deleteCv(id);
    const remaining = cvList.filter((cv) => cv.id !== id);
    setCvList(remaining);
    if (cvMeta?.id === id) onCvChange(remaining[0] ?? null);
  }

  async function handleLegendFileSelected(file: File) {
    setUploadingLegend(true);
    try {
      const meta = await uploadLegendFile(file);
      setLegendList((list) => [...list, meta]);
      setActiveLegendId(meta.id);
      setLegendContentDraft(meta.content);
      onPersonalLegendChange(meta.content);
    } finally {
      setUploadingLegend(false);
    }
  }

  async function handleCreateLegendManually() {
    const name = newLegendName.trim();
    if (!name) return;
    const meta = await createLegend(name, "");
    setLegendList((list) => [...list, meta]);
    setActiveLegendId(meta.id);
    setLegendContentDraft("");
    setNewLegendName("");
    setAddingLegend(false);
    onPersonalLegendChange("");
  }

  async function handleSetActiveLegend(id: string) {
    setSwitchingLegendId(id);
    try {
      const meta = await setActiveLegend(id);
      setActiveLegendId(id);
      setLegendContentDraft(meta?.content ?? "");
      onPersonalLegendChange(meta?.content ?? "");
    } finally {
      setSwitchingLegendId(null);
    }
  }

  async function handleDeleteLegend(id: string) {
    await deleteLegend(id);
    const remaining = legendList.filter((legend) => legend.id !== id);
    setLegendList(remaining);
    if (activeLegendId === id) {
      const next = remaining[0] ?? null;
      setActiveLegendId(next?.id ?? null);
      setLegendContentDraft(next?.content ?? "");
      onPersonalLegendChange(next?.content ?? "");
    }
  }

  async function handleSaveLegendContent() {
    if (!activeLegendId) return;
    setSavingLegendContent(true);
    try {
      await updateLegendContent(activeLegendId, legendContentDraft);
      setLegendList((list) =>
        list.map((legend) => (legend.id === activeLegendId ? { ...legend, content: legendContentDraft } : legend)),
      );
      onPersonalLegendChange(legendContentDraft);
    } finally {
      setSavingLegendContent(false);
    }
  }

  function updateField(field: keyof Profile, value: string) {
    onProfileChange({ ...profile, [field]: value });
  }

  /** Canonicalize phone/salary once, on blur, so autofill always parses the same shape. */
  async function normalizeField(field: keyof Profile) {
    if (field === "phone" && profile.phone) {
      // libphonenumber-js (~110 kB) only for this one blur — load it lazily.
      const { canonicalPhone } = await import("@/lib/phone");
      updateField("phone", canonicalPhone(profile.phone, profile.country));
    } else if (field === "expectedSalary" && profile.expectedSalary) {
      updateField("expectedSalary", formatSalaryForStorage(profile.expectedSalary));
    }
  }

  const FIELD_HINTS: Partial<Record<keyof Profile, string>> = {
    phone: t("settings.phoneHint"),
    expectedSalary: t("settings.salaryHint"),
  };

  async function handleSaveProfile() {
    setProfileSaveNotice(null);
    try {
      await saveProfile(profile);
    } catch (err) {
      // `saveProfile` writes the local cache before the Drive call that can
      // throw here (Google not connected yet) — that write already landed,
      // so the edit isn't lost, it just isn't backed up to Drive yet.
      const message = err instanceof Error ? err.message : "";
      setProfileSaveNotice(
        message.includes("not connected")
          ? t("settings.savedLocallyConnect")
          : t("settings.savedLocallyNoDrive"),
      );
    }
  }

  function handleAddCustomField() {
    setFieldsDraft((fields) => [...fields, { id: crypto.randomUUID(), label: "", value: "" }]);
  }

  function handleCustomFieldChange(id: string, patch: Partial<Omit<CustomField, "id">>) {
    setFieldsDraft((fields) => fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function handleRemoveCustomField(id: string) {
    setFieldsDraft((fields) => fields.filter((f) => f.id !== id));
  }

  async function handleSaveCustomFields() {
    setSavingFields(true);
    try {
      await saveCustomFields(fieldsDraft);
      onCustomFieldsChange(fieldsDraft);
    } finally {
      setSavingFields(false);
    }
  }

  function handleAddLanguageLevel() {
    setLanguagesDraft((levels) => [...levels, { language: "", level: "B1" }]);
  }

  function handleLanguageLevelChange(index: number, patch: Partial<LanguageLevel>) {
    setLanguagesDraft((levels) => levels.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleRemoveLanguageLevel(index: number) {
    setLanguagesDraft((levels) => levels.filter((_, i) => i !== index));
  }

  async function handleSaveLanguageLevels() {
    setSavingLanguages(true);
    try {
      await saveLanguageLevels(languagesDraft);
      onLanguageLevelsChange(languagesDraft);
    } finally {
      setSavingLanguages(false);
    }
  }

  async function handleSaveJobSearchCredentials() {
    setSavingJobSearchCredentials(true);
    try {
      await setJobSearchCredentials(jobSearchCreds);
    } finally {
      setSavingJobSearchCredentials(false);
    }
  }

  async function handleSaveFaqDraft(next: Record<string, string>, nextCustom: FaqEntry[] = customFaqDraft) {
    setSavingFaq(true);
    try {
      const fixed = FAQ_QUESTIONS.map(({ question }) => ({ question, answer: next[question] ?? "" }));
      const custom = nextCustom.filter((e) => e.question.trim());
      const entries = [...fixed, ...custom];
      await saveFaqAnswers(entries);
      onFaqAnswersChange(entries);
    } finally {
      setSavingFaq(false);
    }
  }

  function handleAddCustomFaq() {
    setCustomFaqDraft((entries) => [...entries, { id: crypto.randomUUID(), question: "", answer: "" }]);
  }

  function handleCustomFaqChange(id: string, patch: Partial<Omit<FaqEntry, "id">>) {
    setCustomFaqDraft((entries) => entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  }

  function handleRemoveCustomFaq(id: string) {
    setCustomFaqDraft((entries) => entries.filter((e) => e.id !== id));
  }

  /**
   * Generates only whichever of the 21 questions don't have an answer yet.
   * The background's response carries all 21 (freshly-generated ones plus
   * whatever was already saved) so it can't just replace `faqDraft`
   * wholesale — that would blow away an edit the user typed into an
   * *already-answered* question's textarea but hasn't hit Save for yet.
   * Only apply the entries whose `faqDraft` slot is still genuinely empty.
   */
  async function handleGenerateMissingFaq() {
    setGeneratingFaq(true);
    setFaqError(null);
    try {
      const result = await sendMessage<{ type: "FAQ_ANSWERS_RESULT"; entries: FaqEntry[] }>({
        type: "GENERATE_FAQ_ANSWERS",
        questions: FAQ_QUESTIONS.map((q) => q.question),
      });
      setFaqDraft((prev) => {
        const next = { ...prev };
        for (const entry of result.entries) {
          if (!next[entry.question]?.trim()) next[entry.question] = entry.answer;
        }
        return next;
      });
      onFaqAnswersChange([...result.entries, ...customFaqDraft.filter((e) => e.question.trim())]);
    } catch (err) {
      setFaqError(err instanceof Error ? err.message : t("settings.faqFailed"));
    } finally {
      setGeneratingFaq(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </button>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.preferences")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="ui-language">
              {t("settings.uiLanguage")}
            </label>
            <Select id="ui-language" value={uiLanguage} onChange={(e) => void handleUiLanguageChange(e.target.value as UiLanguagePreference)}>
              <option value="auto">{t("settings.uiLanguageAuto", { language: LOCALE_NAMES[detectLocale(navigator.languages ?? [])] })}</option>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_NAMES[code]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autofillOnOpen}
              onChange={(e) => void handleToggleAutofillOnOpen(e.target.checked)}
            />
            {t("settings.autofillOnOpen")}
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.cvs")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cvList.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("settings.noCv")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("settings.cvsHint")}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {cvList.map((cv) => (
              <CvLibraryItem
                key={cv.id}
                cv={cv}
                active={cv.id === cvMeta?.id}
                switching={switchingCvId === cv.id}
                onActivate={() => void handleSetActiveCv(cv.id)}
                onDelete={() => void handleDeleteCv(cv.id)}
                onDownload={() => handleDownloadCv(cv.id)}
                onSave={(settings) => handleSaveCvSettings(cv.id, settings)}
              />
            ))}
          </div>
          {cvList.length > 1 && (
            <div className="flex flex-col gap-1 rounded-md bg-muted/30 p-2">
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={autoSelectCv}
                  onChange={(e) => void handleCvSelectionPreference({ autoSelectCv: e.target.checked })}
                />
                {t("settings.autoSelectCv")}
              </label>
              <label className={cn("flex items-center gap-2 text-xs", !autoSelectCv && "opacity-50")}>
                <input
                  type="checkbox"
                  checked={aiChooseCv}
                  disabled={!autoSelectCv}
                  onChange={(e) => void handleCvSelectionPreference({ aiChooseCv: e.target.checked })}
                />
                {t("settings.aiChooseCv")}
              </label>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept={CV_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCvSelected(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? t("common.processing") : t("settings.uploadCv")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("settings.cvFormats")}</p>
          {cvUploadError && <p className="text-xs text-destructive">{cvUploadError}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.legend")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {legendList.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("settings.legendHint")}
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {legendList.map((legend) => {
              const isActive = legend.id === activeLegendId;
              return (
                <div
                  key={legend.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2",
                    isActive ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="active-legend"
                      checked={isActive}
                      disabled={switchingLegendId === legend.id}
                      onChange={() => void handleSetActiveLegend(legend.id)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={legend.name}>
                      {legend.name || t("settings.untitledLegend")}
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {t("common.active")}
                      </span>
                    )}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDownloadLegend(legend)}
                    aria-label={t("settings.downloadLegend")}
                    title={t("settings.downloadLegend")}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void handleDeleteLegend(legend.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          {activeLegendId && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t("settings.legendContent")}</label>
              <textarea
                className="min-h-32 rounded-md border border-border bg-background p-2 text-sm outline-none"
                placeholder={t("settings.legendPlaceholder")}
                value={legendContentDraft}
                onChange={(e) => setLegendContentDraft(e.target.value)}
              />
              <Button size="sm" onClick={handleSaveLegendContent} disabled={savingLegendContent} className="w-fit">
                {savingLegendContent ? t("common.saving") : t("common.save")}
              </Button>
            </div>
          )}

          <input
            ref={legendFileInputRef}
            type="file"
            accept=".txt,.md,application/pdf,text/plain,text/markdown"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleLegendFileSelected(file);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => legendFileInputRef.current?.click()}
              disabled={uploadingLegend}
            >
              {uploadingLegend ? t("common.processing") : t("settings.uploadLegend")}
            </Button>
            {addingLegend ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newLegendName}
                  onChange={(e) => setNewLegendName(e.target.value)}
                  placeholder={t("settings.legendName")}
                  className="h-8 w-40 text-xs"
                />
                <Button size="sm" onClick={() => void handleCreateLegendManually()} disabled={!newLegendName.trim()}>
                  {t("common.create")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingLegend(false)}>
                  {t("common.cancel")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAddingLegend(true)}>
                {t("settings.addManually")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.generationRules")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.generationRulesHint")}
          </p>
          <RulesEditor
            initial={generationRules}
            placeholder={t("settings.generationRulesPlaceholder")}
            defaultFileName="cover-letter-rules.md"
            load={getGenerationRules}
            save={saveGenerationRules}
            onSaved={onGenerationRulesChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.outreach")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.outreachHint")}
          </p>
          <RulesEditor
            initial={outreachRules}
            placeholder={t("settings.outreachPlaceholder")}
            defaultFileName="outreach-rules.md"
            load={getOutreachRules}
            save={saveOutreachRules}
            onSaved={onOutreachRulesChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("main.profile")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(Object.keys(EMPTY_PROFILE) as (keyof Profile)[]).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{t(`profile.${field}`)}</label>
              {field === "salutation" ? (
                <Select value={profile.salutation} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">{t("common.select")}</option>
                  {SALUTATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : field === "pronouns" ? (
                <Select value={profile.pronouns} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">{t("common.select")}</option>
                  {PRONOUN_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : field === "country" ? (
                <Select value={profile.country} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">{t("common.select")}</option>
                  {COUNTRIES.map((country) => (
                    <option key={country} value={country}>
                      {country}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={profile[field]}
                  onChange={(e) => updateField(field, e.target.value)}
                  onBlur={() => void normalizeField(field)}
                />
              )}
              {FIELD_HINTS[field] && (
                <p className="text-[11px] text-muted-foreground">{FIELD_HINTS[field]}</p>
              )}
            </div>
          ))}
          <Button size="sm" onClick={handleSaveProfile}>
            {t("settings.saveProfile")}
          </Button>
          {profileSaveNotice && <p className="text-xs text-muted-foreground">{profileSaveNotice}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("main.customFields")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.customFieldsHint")}
          </p>
          {fieldsDraft.map((field) => (
            <div key={field.id} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("settings.label")}</label>
                <Input
                  value={field.label}
                  onChange={(e) => handleCustomFieldChange(field.id, { label: e.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("settings.value")}</label>
                <Input
                  value={field.value}
                  onChange={(e) => handleCustomFieldChange(field.id, { value: e.target.value })}
                />
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleRemoveCustomField(field.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAddCustomField}>
              {t("settings.addField")}
            </Button>
            <Button size="sm" onClick={handleSaveCustomFields} disabled={savingFields}>
              {savingFields ? t("common.saving") : t("settings.saveCustomFields")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.myLanguages")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.myLanguagesHint")}
          </p>
          {languagesDraft.map((entry, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("settings.language")}</label>
                <Select
                  value={entry.language}
                  onChange={(e) => handleLanguageLevelChange(index, { language: e.target.value })}
                >
                  <option value="">{t("common.select")}</option>
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex w-24 flex-col gap-1">
                <label className="text-xs text-muted-foreground">{t("settings.level")}</label>
                <Select
                  value={entry.level}
                  onChange={(e) => handleLanguageLevelChange(index, { level: e.target.value as LanguageLevel["level"] })}
                >
                  {CEFR_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="sm" variant="ghost" onClick={() => handleRemoveLanguageLevel(index)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleAddLanguageLevel}>
              {t("settings.addLanguage")}
            </Button>
            <Button size="sm" onClick={handleSaveLanguageLevels} disabled={savingLanguages}>
              {savingLanguages ? t("common.saving") : t("settings.saveLanguages")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.faq")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            {t("settings.faqHint")}
          </p>
          <p className="text-xs">
            {t("settings.faqSummary", { answered: faqAnsweredCount, total: FAQ_QUESTIONS.length, custom: customFaqDraft.filter((e) => e.question.trim()).length })}
          </p>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => faqDialogRef.current?.showModal()}>
            {t("settings.editFaq")}
          </Button>
          <dialog
            ref={faqDialogRef}
            aria-labelledby="faq-dialog-title"
            className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overscroll-contain rounded-lg border border-border bg-background p-0 text-foreground shadow-xl backdrop:overflow-hidden backdrop:overscroll-contain backdrop:bg-black/40"
          >
            <div className="flex max-h-[calc(100dvh-2rem)] flex-col">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <h2 id="faq-dialog-title" className="text-base font-semibold">
                  {t("settings.faq")}
                </h2>
                <form method="dialog">
                  <Button size="sm" variant="ghost" aria-label={t("common.close")} title={t("common.close")}>
                    <X className="h-4 w-4" />
                  </Button>
                </form>
              </div>
              <div className="flex flex-col gap-2 overflow-y-auto overscroll-contain bg-muted/20 px-4 py-3">
                {FAQ_GROUPS.map(([category, items]) => (
                  <section key={category} className="flex flex-col gap-2">
                    <FaqChatDivider>{category}</FaqChatDivider>
                    {items.map(({ question }) => (
                      <div key={question} className="flex flex-col gap-1">
                        <FaqQuestionBubble question={question} />
                        <FaqAnswerBubble
                          answer={faqDraft[question] ?? ""}
                          label={question}
                          placeholder={t("settings.notGenerated")}
                          onChange={(value) => setFaqDraft((prev) => ({ ...prev, [question]: value }))}
                        />
                      </div>
                    ))}
                  </section>
                ))}

                <section className="flex flex-col gap-2">
                  <FaqChatDivider>{t("settings.customQuestions")}</FaqChatDivider>
                  <p className="text-center text-[11px] text-muted-foreground">{t("settings.customQuestionsHint")}</p>
                  {customFaqDraft.map((entry) => (
                    <div key={entry.id} className="flex flex-col gap-1">
                      <FaqQuestionBubble
                        question={entry.question}
                        placeholder={t("settings.question")}
                        onChange={(value) => handleCustomFaqChange(entry.id!, { question: value })}
                        onDelete={() => handleRemoveCustomFaq(entry.id!)}
                        deleteLabel={t("settings.deleteQuestion")}
                      />
                      <FaqAnswerBubble
                        answer={entry.answer}
                        label={entry.question || t("settings.answer")}
                        placeholder={t("settings.answer")}
                        onChange={(value) => handleCustomFaqChange(entry.id!, { answer: value })}
                      />
                    </div>
                  ))}
                  <Button size="sm" variant="outline" className="w-fit self-center" onClick={handleAddCustomFaq}>
                    {t("settings.addQuestion")}
                  </Button>
                </section>
              </div>
              <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
                {faqError && <p className="text-xs text-destructive">{faqError}</p>}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={handleGenerateMissingFaq} disabled={generatingFaq}>
                    {generatingFaq ? t("common.generating") : t("settings.generateMissing")}
                  </Button>
                  <Button size="sm" onClick={() => void handleSaveFaqDraft(faqDraft)} disabled={savingFaq}>
                    {savingFaq ? t("common.saving") : t("settings.saveFaq")}
                  </Button>
                </div>
              </div>
            </div>
          </dialog>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.jobSearchProviders")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.jobSearchProvidersHint")}
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Tavily API key</label>
            <Input
              type="password"
              value={jobSearchCreds.tavilyApiKey}
              onChange={(e) => setJobSearchCreds((prev) => ({ ...prev, tavilyApiKey: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Adzuna app_id</label>
            <Input
              value={jobSearchCreds.adzunaAppId}
              onChange={(e) => setJobSearchCreds((prev) => ({ ...prev, adzunaAppId: e.target.value }))}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Adzuna app_key</label>
            <Input
              type="password"
              value={jobSearchCreds.adzunaAppKey}
              onChange={(e) => setJobSearchCreds((prev) => ({ ...prev, adzunaAppKey: e.target.value }))}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {t("settings.adzunaHint")}
          </p>
          <Button size="sm" variant="outline" onClick={handleSaveJobSearchCredentials} disabled={savingJobSearchCredentials}>
            {savingJobSearchCredentials ? t("common.saving") : t("common.save")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.aiModels")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            {t("settings.aiModelsHint")}
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("settings.modelCoverLetters")}</label>
            <Select value={coverLetterModel} onChange={(e) => void handleCoverLetterModelChange(e.target.value)}>
              {renderModelOptions(coverLetterModel, MODEL_TERRA)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t("settings.modelExtraction")}
            </label>
            <Select value={extractionModel} onChange={(e) => void handleExtractionModelChange(e.target.value)}>
              {renderModelOptions(extractionModel, MODEL_LUNA)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t("settings.modelAnalysis")}
            </label>
            <Select value={jobAnalysisModel} onChange={(e) => void handleJobAnalysisModelChange(e.target.value)}>
              {renderModelOptions(jobAnalysisModel, MODEL_LUNA)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              {t("settings.modelSupport")}
            </label>
            <Select value={supportModel} onChange={(e) => void handleSupportModelChange(e.target.value)}>
              {renderModelOptions(supportModel, MODEL_LUNA)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t("settings.modelOutreach")}</label>
            <Select value={outreachModel} onChange={(e) => void handleOutreachModelChange(e.target.value)}>
              {renderModelOptions(outreachModel, MODEL_TERRA)}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.yourData")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            {t("settings.yourDataHint")}
          </p>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => void handleExportData()} disabled={exporting}>
            {exporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("settings.collecting")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" /> {t("settings.exportAll")}
              </>
            )}
          </Button>
          {exportNotice && <p className="text-xs text-muted-foreground">{exportNotice}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.openAiKey")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              await deleteOpenAiApiKey();
              onApiKeyDeleted();
            }}
          >
            {t("settings.deleteKey")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.googleAccount")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="destructive"
            onClick={async () => {
              await disconnectGoogle();
              onGoogleDisconnected();
            }}
          >
            {t("settings.disconnectGoogle")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("settings.feedback")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {t("settings.feedbackHint1")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("settings.feedbackHint2")}
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href="mailto:msk.vitaly@gmail.com?subject=Filler%20feedback"
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Mail className="h-3.5 w-3.5" /> msk.vitaly@gmail.com
            </a>
            <a
              href="https://t.me/mskVitalii"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Send className="h-3.5 w-3.5" /> Telegram @mskVitalii
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
