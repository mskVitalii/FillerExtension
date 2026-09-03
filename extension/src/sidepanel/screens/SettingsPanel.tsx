import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  EMPTY_PROFILE,
  SALUTATION_OPTIONS,
  PRONOUN_OPTIONS,
  type CustomField,
  type CvMeta,
  type LanguageLevel,
  type Profile,
} from "@/types/profile";
import { CEFR_LEVELS } from "@/lib/language-level";
import {
  deleteCv,
  saveCustomFields,
  saveLanguageLevels,
  saveProfile,
  savePersonalLegend,
  uploadCv,
} from "@/features/profile/repository";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { disconnectGoogle } from "@/features/google-drive/auth";
import { deleteOpenAiApiKey } from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { extractPdfText } from "@/lib/pdf-text";
import { COUNTRIES } from "@/lib/countries";
import { formatSalaryForStorage } from "@/lib/salary";

interface SettingsPanelProps {
  profile: Profile;
  cvMeta: CvMeta | null;
  legendContent: string;
  customFields: CustomField[];
  languageLevels: LanguageLevel[];
  onBack: () => void;
  onProfileChange: (profile: Profile) => void;
  onCvChange: (cvMeta: CvMeta | null) => void;
  onLegendChange: (content: string) => void;
  onCustomFieldsChange: (fields: CustomField[]) => void;
  onLanguageLevelsChange: (levels: LanguageLevel[]) => void;
  onApiKeyDeleted: () => void;
  onGoogleDisconnected: () => void;
}

export function SettingsPanel({
  profile,
  cvMeta,
  legendContent,
  customFields,
  languageLevels,
  onBack,
  onProfileChange,
  onCvChange,
  onLegendChange,
  onCustomFieldsChange,
  onLanguageLevelsChange,
  onApiKeyDeleted,
  onGoogleDisconnected,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [legendDraft, setLegendDraft] = useState(legendContent);
  const [savingLegend, setSavingLegend] = useState(false);
  const [autofillOnOpen, setAutofillOnOpen] = useState(true);
  const [fieldsDraft, setFieldsDraft] = useState(customFields);
  const [savingFields, setSavingFields] = useState(false);
  const [languagesDraft, setLanguagesDraft] = useState(languageLevels);
  const [savingLanguages, setSavingLanguages] = useState(false);

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
      onCvChange(meta);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteCv() {
    await deleteCv();
    onCvChange(null);
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
          <CardTitle>CV</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {cvMeta ? (
            <p className="text-sm">{cvMeta.fileName}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No CV uploaded yet.</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCvSelected(file);
            }}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? "Processing…" : cvMeta ? "Replace CV" : "Upload CV"}
            </Button>
            {cvMeta && (
              <Button size="sm" variant="ghost" onClick={handleDeleteCv}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
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
