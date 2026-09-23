import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  EMPTY_PROFILE,
  SALUTATION_OPTIONS,
  PRONOUN_OPTIONS,
  type CustomField,
  type CvMeta,
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
  getCvLibrary,
  getLegendLibrary,
  saveCustomFields,
  saveFaqAnswers,
  saveGenerationRules,
  saveLanguageLevels,
  saveProfile,
  setActiveCv,
  setActiveLegend,
  updateLegendContent,
  uploadCv,
  uploadLegendFile,
} from "@/features/profile/repository";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { disconnectGoogle } from "@/features/google-drive/auth";
import { AVAILABLE_MODELS, MODEL_LUNA, MODEL_TERRA } from "@/features/openai/client";
import {
  deleteOpenAiApiKey,
  getJobSearchCredentials,
  setJobSearchCredentials,
  type JobSearchCredentials,
} from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { extractPdfText } from "@/lib/pdf-text";
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
  onBack: () => void;
  onProfileChange: (profile: Profile) => void;
  onCvChange: (cvMeta: CvMeta | null) => void;
  onCustomFieldsChange: (fields: CustomField[]) => void;
  onLanguageLevelsChange: (levels: LanguageLevel[]) => void;
  onFaqAnswersChange: (entries: FaqEntry[]) => void;
  /** Fires whenever the active Personal Legend's content changes (upload, manual create, switch, edit) — mirrors it into App-level state so the Job Search preview (spec_8 item 8) stays in sync without a full reload. */
  onPersonalLegendChange: (content: string) => void;
  onGenerationRulesChange: (content: string) => void;
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
  onBack,
  onProfileChange,
  onCvChange,
  onCustomFieldsChange,
  onLanguageLevelsChange,
  onFaqAnswersChange,
  onPersonalLegendChange,
  onGenerationRulesChange,
  onApiKeyDeleted,
  onGoogleDisconnected,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
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
  const [coverLetterModel, setCoverLetterModel] = useState<string>(MODEL_TERRA);
  const [extractionModel, setExtractionModel] = useState<string>(MODEL_LUNA);
  const [jobAnalysisModel, setJobAnalysisModel] = useState<string>(MODEL_LUNA);
  const [supportModel, setSupportModel] = useState<string>(MODEL_LUNA);
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
  const [jobSearchCreds, setJobSearchCreds] = useState<JobSearchCredentials>({
    tavilyApiKey: "",
    adzunaAppId: "",
    adzunaAppKey: "",
  });
  const [savingJobSearchCredentials, setSavingJobSearchCredentials] = useState(false);
  const [rulesDraft, setRulesDraft] = useState(generationRules);
  const [savingRules, setSavingRules] = useState(false);
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
      setCoverLetterModel(prefs.coverLetterModel || MODEL_TERRA);
      setExtractionModel(prefs.extractionModel || MODEL_LUNA);
      setJobAnalysisModel(prefs.jobAnalysisModel || MODEL_LUNA);
      setSupportModel(prefs.supportModel || MODEL_LUNA);
    });
  }, []);

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

  async function handleCvSelected(file: File) {
    setUploading(true);
    try {
      const text = await extractPdfText(file);
      const meta = await uploadCv(file, text);
      setCvList((list) => [...list, meta]);
      onCvChange(meta);
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
    phone: "Any format — it's stored as +49… and reshaped per form (0170…, separate country code, …).",
    expectedSalary: "A number or a range (e.g. 65000 - 75000). Number-only fields get the range midpoint, rounded.",
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
          ? "Saved locally — connect Google Drive in Settings to back this up."
          : "Saved locally, but couldn't reach Google Drive.",
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
      setFaqError(err instanceof Error ? err.message : "Couldn't generate FAQ answers.");
    } finally {
      setGeneratingFaq(false);
    }
  }

  async function handleSaveGenerationRules() {
    setSavingRules(true);
    try {
      await saveGenerationRules(rulesDraft);
      onGenerationRulesChange(rulesDraft);
    } finally {
      setSavingRules(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <button onClick={onBack} className="flex w-fit items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autofillOnOpen}
              onChange={(e) => void handleToggleAutofillOnOpen(e.target.checked)}
            />
            Autofill the page automatically when I open a job application
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>CVs</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cvList.length === 0 ? (
            <p className="text-sm text-muted-foreground">No CV uploaded yet.</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Autofill and cover-letter generation use whichever one is active.
            </p>
          )}
          <div className="flex flex-col gap-1.5">
            {cvList.map((cv) => {
              const isActive = cv.id === cvMeta?.id;
              return (
                <div
                  key={cv.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-2",
                    isActive ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="active-cv"
                      checked={isActive}
                      disabled={switchingCvId === cv.id}
                      onChange={() => void handleSetActiveCv(cv.id)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={cv.fileName}>
                      {cv.fileName}
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Active
                      </span>
                    )}
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => void handleDeleteCv(cv.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
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
            {uploading ? "Processing…" : "Upload another CV"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Personal Legend</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {legendList.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Cover-letter and answer generation use whichever one is active — the Job Search
              tab's OpenAI/Tavily providers also search grounded in it, so it doubles as your
              candidate background there.
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
                      {legend.name || "Untitled legend"}
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        Active
                      </span>
                    )}
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => void handleDeleteLegend(legend.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>

          {activeLegendId && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Content of the active legend</label>
              <textarea
                className="min-h-32 rounded-md border border-border bg-background p-2 text-sm outline-none"
                placeholder="Experience, projects, achievements, technologies, education, motivation, career goals…"
                value={legendContentDraft}
                onChange={(e) => setLegendContentDraft(e.target.value)}
              />
              <Button size="sm" onClick={handleSaveLegendContent} disabled={savingLegendContent} className="w-fit">
                {savingLegendContent ? "Saving…" : "Save"}
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
              {uploadingLegend ? "Processing…" : "Upload a legend file"}
            </Button>
            {addingLegend ? (
              <div className="flex items-center gap-2">
                <Input
                  value={newLegendName}
                  onChange={(e) => setNewLegendName(e.target.value)}
                  placeholder="Legend name"
                  className="h-8 w-40 text-xs"
                />
                <Button size="sm" onClick={() => void handleCreateLegendManually()} disabled={!newLegendName.trim()}>
                  Create
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAddingLegend(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setAddingLegend(true)}>
                Add manually
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Generation Rules</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Instructions for how AI-generated text (cover letter, FAQ answers, application-question
            answers) should be written — tone, length, structure, things to include or avoid. Kept
            separate from the Personal Legend, which is about what's true, not how it's phrased.
          </p>
          <textarea
            className="min-h-24 rounded-md border border-border bg-background p-2 text-sm outline-none"
            placeholder="e.g. Keep cover letters under 250 words. Never mention relocation. Write in first person, direct and confident, no corporate buzzwords…"
            value={rulesDraft}
            onChange={(e) => setRulesDraft(e.target.value)}
          />
          <Button size="sm" onClick={handleSaveGenerationRules} disabled={savingRules} className="w-fit">
            {savingRules ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(Object.keys(EMPTY_PROFILE) as (keyof Profile)[]).map((field) => (
            <div key={field} className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">{PROFILE_FIELD_LABELS[field]}</label>
              {field === "salutation" ? (
                <Select value={profile.salutation} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">Select…</option>
                  {SALUTATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : field === "pronouns" ? (
                <Select value={profile.pronouns} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">Select…</option>
                  {PRONOUN_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : field === "country" ? (
                <Select value={profile.country} onChange={(e) => updateField(field, e.target.value)}>
                  <option value="">Select…</option>
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
            Save Profile
          </Button>
          {profileSaveNotice && <p className="text-xs text-muted-foreground">{profileSaveNotice}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Custom Fields</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Extra values you can drag onto a page — kept separate from Profile so they're never
            picked up by Autofill Application.
          </p>
          {fieldsDraft.map((field) => (
            <div key={field.id} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Label</label>
                <Input
                  value={field.label}
                  onChange={(e) => handleCustomFieldChange(field.id, { label: e.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Value</label>
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
              Add field
            </Button>
            <Button size="sm" onClick={handleSaveCustomFields} disabled={savingFields}>
              {savingFields ? "Saving…" : "Save Custom Fields"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>My Languages</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Your own proficiency, compared against a posting's language requirements so you can
            tell at a glance whether it's worth your time.
          </p>
          {languagesDraft.map((entry, index) => (
            <div key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Language</label>
                <Select
                  value={entry.language}
                  onChange={(e) => handleLanguageLevelChange(index, { language: e.target.value })}
                >
                  <option value="">Select…</option>
                  {LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex w-24 flex-col gap-1">
                <label className="text-xs text-muted-foreground">Level</label>
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
              Add language
            </Button>
            <Button size="sm" onClick={handleSaveLanguageLevels} disabled={savingLanguages}>
              {savingLanguages ? "Saving…" : "Save Languages"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Standard interview questions almost every application asks in some form. Pre-written
            answers here get reused when a real form asks a close variant, instead of being
            guessed fresh every time.
          </p>
          {FAQ_GROUPS.map(([category, items]) => (
            <div key={category} className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</h4>
              {items.map(({ question }) => (
                <div key={question} className="flex flex-col gap-1">
                  <label className="text-xs font-medium">{question}</label>
                  <textarea
                    className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
                    value={faqDraft[question] ?? ""}
                    placeholder="Not generated yet."
                    onChange={(e) => setFaqDraft((prev) => ({ ...prev, [question]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ))}

          <div className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Custom Questions
            </h4>
            <p className="text-[11px] text-muted-foreground">
              Your own recurring questions and answers, reused the same way as the standard ones above.
            </p>
            {customFaqDraft.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 rounded-md border border-border bg-background p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={entry.question}
                    onChange={(e) => handleCustomFaqChange(entry.id!, { question: e.target.value })}
                    placeholder="Question"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button size="sm" variant="ghost" onClick={() => handleRemoveCustomFaq(entry.id!)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <textarea
                  className="min-h-16 rounded-md border border-border bg-background p-2 text-sm outline-none"
                  value={entry.answer}
                  placeholder="Answer"
                  onChange={(e) => handleCustomFaqChange(entry.id!, { answer: e.target.value })}
                />
              </div>
            ))}
            <Button size="sm" variant="outline" className="w-fit" onClick={handleAddCustomFaq}>
              Add question
            </Button>
          </div>

          {faqError && <p className="text-xs text-destructive">{faqError}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerateMissingFaq} disabled={generatingFaq}>
              {generatingFaq ? "Generating…" : "Generate missing answers"}
            </Button>
            <Button size="sm" onClick={() => void handleSaveFaqDraft(faqDraft)} disabled={savingFaq}>
              {savingFaq ? "Saving…" : "Save FAQ Answers"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job Search Providers</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Optional — the Job Search tab always offers OpenAI web search (uses your OpenAI key
            above); add either of these to also search Tavily or Adzuna.
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
            Get Adzuna credentials at developer.adzuna.com — search location defaults to your
            Profile country.
          </p>
          <Button size="sm" variant="outline" onClick={handleSaveJobSearchCredentials} disabled={savingJobSearchCredentials}>
            {savingJobSearchCredentials ? "Saving…" : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI Models</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Four model tiers, chosen per task by cost/latency vs. quality — all billed to your own OpenAI key.
          </p>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Cover letters</label>
            <Select value={coverLetterModel} onChange={(e) => void handleCoverLetterModelChange(e.target.value)}>
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Job posting extraction (from page text or pasted text)
            </label>
            <Select value={extractionModel} onChange={(e) => void handleExtractionModelChange(e.target.value)}>
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Job analysis (requirements, tone, language, keywords)
            </label>
            <Select value={jobAnalysisModel} onChange={(e) => void handleJobAnalysisModelChange(e.target.value)}>
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">
              Everything else (questions, checkboxes, search, translation)
            </label>
            <Select value={supportModel} onChange={(e) => void handleSupportModelChange(e.target.value)}>
              {AVAILABLE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>OpenAI API Key</CardTitle>
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
            Delete API Key
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Account</CardTitle>
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
            Disconnect Google
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
