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
  type Profile,
} from "@/types/profile";
import { CEFR_LEVELS } from "@/lib/language-level";
import {
  deleteCv,
  getCvLibrary,
  saveCandidateSummary,
  saveCustomFields,
  saveFaqAnswers,
  saveLanguageLevels,
  saveProfile,
  savePersonalLegend,
  setActiveCv,
  uploadCv,
} from "@/features/profile/repository";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { disconnectGoogle } from "@/features/google-drive/auth";
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
  legendContent: string;
  customFields: CustomField[];
  languageLevels: LanguageLevel[];
  faqAnswers: FaqEntry[];
  candidateSummary: string;
  onBack: () => void;
  onProfileChange: (profile: Profile) => void;
  onCvChange: (cvMeta: CvMeta | null) => void;
  onLegendChange: (content: string) => void;
  onCustomFieldsChange: (fields: CustomField[]) => void;
  onLanguageLevelsChange: (levels: LanguageLevel[]) => void;
  onFaqAnswersChange: (entries: FaqEntry[]) => void;
  onCandidateSummaryChange: (content: string) => void;
  onApiKeyDeleted: () => void;
  onGoogleDisconnected: () => void;
}

export function SettingsPanel({
  profile,
  cvMeta,
  legendContent,
  customFields,
  languageLevels,
  faqAnswers,
  candidateSummary,
  onBack,
  onProfileChange,
  onCvChange,
  onLegendChange,
  onCustomFieldsChange,
  onLanguageLevelsChange,
  onFaqAnswersChange,
  onCandidateSummaryChange,
  onApiKeyDeleted,
  onGoogleDisconnected,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [cvList, setCvList] = useState<CvMeta[]>([]);
  const [switchingCvId, setSwitchingCvId] = useState<string | null>(null);
  const [legendDraft, setLegendDraft] = useState(legendContent);
  const [savingLegend, setSavingLegend] = useState(false);
  const [autofillOnOpen, setAutofillOnOpen] = useState(true);
  const [fieldsDraft, setFieldsDraft] = useState(customFields);
  const [savingFields, setSavingFields] = useState(false);
  const [languagesDraft, setLanguagesDraft] = useState(languageLevels);
  const [savingLanguages, setSavingLanguages] = useState(false);
  const [faqDraft, setFaqDraft] = useState<Record<string, string>>(
    Object.fromEntries(faqAnswers.map((e) => [e.question, e.answer])),
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
  const [summaryDraft, setSummaryDraft] = useState(candidateSummary);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [savingSummary, setSavingSummary] = useState(false);

  useEffect(() => {
    void getJobSearchCredentials().then(setJobSearchCreds);
  }, []);

  useEffect(() => {
    void getCvLibrary().then((library) => setCvList(library.items));
  }, []);

  useEffect(() => {
    void getPreferences().then((prefs) => setAutofillOnOpen(prefs.autofillOnOpen));
  }, []);

  async function handleToggleAutofillOnOpen(checked: boolean) {
    setAutofillOnOpen(checked);
    await setPreferences({ autofillOnOpen: checked });
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

  async function handleSaveLegend() {
    setSavingLegend(true);
    await savePersonalLegend(legendDraft);
    onLegendChange(legendDraft);
    setSavingLegend(false);
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
    await saveProfile(profile);
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

  async function handleSaveFaqDraft(next: Record<string, string>) {
    setSavingFaq(true);
    try {
      const entries = FAQ_QUESTIONS.map(({ question }) => ({ question, answer: next[question] ?? "" }));
      await saveFaqAnswers(entries);
      onFaqAnswersChange(entries);
    } finally {
      setSavingFaq(false);
    }
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
      onFaqAnswersChange(result.entries);
    } catch (err) {
      setFaqError(err instanceof Error ? err.message : "Couldn't generate FAQ answers.");
    } finally {
      setGeneratingFaq(false);
    }
  }

  async function handleGenerateCandidateSummary() {
    setGeneratingSummary(true);
    setSummaryError(null);
    try {
      const result = await sendMessage<{ type: "CANDIDATE_SUMMARY_RESULT"; content: string }>({
        type: "GENERATE_CANDIDATE_SUMMARY",
      });
      setSummaryDraft(result.content);
      onCandidateSummaryChange(result.content);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Couldn't generate the candidate summary.");
    } finally {
      setGeneratingSummary(false);
    }
  }

  async function handleSaveCandidateSummary() {
    setSavingSummary(true);
    try {
      await saveCandidateSummary(summaryDraft);
      onCandidateSummaryChange(summaryDraft);
    } finally {
      setSavingSummary(false);
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
          <textarea
            className="min-h-32 rounded-md border border-border bg-background p-2 text-sm outline-none"
            placeholder="Experience, projects, achievements, technologies, education, motivation, career goals…"
            value={legendDraft}
            onChange={(e) => setLegendDraft(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={handleSaveLegend} disabled={savingLegend}>
            {savingLegend ? "Saving…" : "Save"}
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
          <Button size="sm" variant="outline" onClick={handleSaveProfile}>
            Save Profile
          </Button>
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
                <Input
                  value={entry.language}
                  onChange={(e) => handleLanguageLevelChange(index, { language: e.target.value })}
                />
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
            <div key={category} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground">{category}</h4>
              {items.map(({ question }) => (
                <div key={question} className="flex flex-col gap-1">
                  <label className="text-xs">{question}</label>
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
          <CardTitle>Candidate Summary</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            A full digest of your profile, CV, Personal Legend, custom fields, languages, and
            FAQ answers — this is what the Job Search tab's OpenAI/Tavily providers actually
            search with, so results are grounded in everything about you, not just a typed
            keyword. Generated automatically the first time you search if you skip this, but
            reviewing/editing it here is worth it.
          </p>
          <textarea
            className="min-h-32 rounded-md border border-border bg-background p-2 text-sm outline-none"
            placeholder="Not generated yet."
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
          />
          {summaryError && <p className="text-xs text-destructive">{summaryError}</p>}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleGenerateCandidateSummary} disabled={generatingSummary}>
              {generatingSummary ? "Generating…" : summaryDraft ? "Regenerate" : "Generate"}
            </Button>
            <Button size="sm" onClick={handleSaveCandidateSummary} disabled={savingSummary}>
              {savingSummary ? "Saving…" : "Save"}
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
