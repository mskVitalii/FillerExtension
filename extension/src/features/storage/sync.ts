/**
 * chrome.storage.sync — small cross-device preferences only
 * (spec section 20). Never store documents or secrets here.
 */
export interface Preferences {
  autofillOnOpen: boolean;
  pdfFontSize: number;
}

const DEFAULT_PREFERENCES: Preferences = {
  autofillOnOpen: true,
  pdfFontSize: 11,
};

export async function getPreferences(): Promise<Preferences> {
  const result = await chrome.storage.sync.get("preferences");
  return { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<Preferences> | undefined) };
}

export async function setPreferences(preferences: Partial<Preferences>): Promise<void> {
  const current = await getPreferences();
  await chrome.storage.sync.set({ preferences: { ...current, ...preferences } });
}
