import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EMPTY_PROFILE, SALUTATION_OPTIONS, type CvMeta, type Profile } from "@/types/profile";
import { deleteCv, saveProfile, savePersonalLegend, uploadCv } from "@/features/profile/repository";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";
import { deleteOpenAiApiKey } from "@/features/storage/local";
import { getPreferences, setPreferences } from "@/features/storage/sync";
import { extractPdfText } from "@/lib/pdf-text";
import { COUNTRIES } from "@/lib/countries";

interface SettingsPanelProps {
  profile: Profile;
  cvMeta: CvMeta | null;
  legendContent: string;
  onBack: () => void;
  onProfileChange: (profile: Profile) => void;
  onCvChange: (cvMeta: CvMeta | null) => void;
  onLegendChange: (content: string) => void;
  onApiKeyDeleted: () => void;
}

export function SettingsPanel({
  profile,
  cvMeta,
  legendContent,
  onBack,
  onProfileChange,
  onCvChange,
  onLegendChange,
  onApiKeyDeleted,
}: SettingsPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [legendDraft, setLegendDraft] = useState(legendContent);
  const [savingLegend, setSavingLegend] = useState(false);
  const [autofillOnOpen, setAutofillOnOpen] = useState(true);

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

  async function handleSaveProfile() {
    await saveProfile(profile);
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
                <Input value={profile[field]} onChange={(e) => updateField(field, e.target.value)} />
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
    </div>
  );
}
