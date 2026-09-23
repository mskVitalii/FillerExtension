/**
 * chrome.storage.sync — small cross-device preferences only
 * (spec section 20). Never store documents or secrets here.
 */
export interface Preferences {
  autofillOnOpen: boolean;
  pdfFontSize: number;
  /** Remembered choice for the Cover Letter "Translate" tab (spec_2 item 3). */
  translateLanguage: string;
  /** User's chosen model for the cover-letter tier — "" defers to that tier's built-in default (see `getCoverLetterModel` in features/openai/client.ts). */
  coverLetterModel: string;
  /** User's chosen model for job-posting extraction from page/pasted text — "" defers to the built-in default (see `getExtractionModel`). */
  extractionModel: string;
  /** User's chosen model for analyzing an already-extracted job posting — "" defers to the built-in default (see `getJobAnalysisModel`). */
  jobAnalysisModel: string;
  /** User's chosen model for the support tier — "" defers to that tier's built-in default (see `getSupportModel` in features/openai/client.ts). */
  supportModel: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  autofillOnOpen: true,
  pdfFontSize: 11,
  translateLanguage: "Russian",
  coverLetterModel: "",
  extractionModel: "",
  jobAnalysisModel: "",
  supportModel: "",
};

export async function getPreferences(): Promise<Preferences> {
  const result = await chrome.storage.sync.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<Preferences> | undefined) };
}

export async function setPreferences(preferences: Partial<Preferences>): Promise<void> {
  const current = await getPreferences();
  await chrome.storage.sync.set({ preferences: { ...current, ...preferences } });
}
