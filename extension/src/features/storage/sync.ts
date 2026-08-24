/**
 * chrome.storage.sync — small cross-device preferences only
 * (spec section 20). Never store documents or secrets here.
 */
export interface Preferences {
  autofillOnOpen: boolean;
  pdfFontSize: number;
  /** Remembered choice for the Cover Letter "Translate" tab (spec_2 item 3). */
  translateLanguage: string;
}

const DEFAULT_PREFERENCES: Preferences = {
  autofillOnOpen: true,
  pdfFontSize: 11,
  translateLanguage: "Russian",
};

export async function getPreferences(): Promise<Preferences> {
  const result = await chrome.storage.sync.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<Preferences> | undefined) };
}

export async function setPreferences(preferences: Partial<Preferences>): Promise<void> {
  const current = await getPreferences();
  await chrome.storage.sync.set({ preferences: { ...current, ...preferences } });
}
