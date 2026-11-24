import type { UiLanguagePreference } from "@/i18n/core";
import type { AiFallbackPolicy } from "@/features/openai/fallback";
import { DEFAULT_PROJECT_ID } from "@/features/projects/registry";
import { currentProjectId } from "@/features/projects/scope";

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
  /** User's chosen model for the outreach-message tier — "" defers to the built-in default (see `getOutreachModel`). */
  outreachModel: string;
  /**
   * Job Search tab's "what I don't want" text. Every preference shares the one `preferences`
   * item, and sync allows 8 KB per item — so it's capped at `MAX_NEGATIVE_PROMPT_LENGTH`.
   */
  jobSearchNegativePrompt: string;
  /** Settings → CVs: pick the CV per posting by its language and rules (on), or always use the active one (off). */
  autoSelectCv: boolean;
  /** Settings → CVs: ask the support model to choose the CV instead of the offline language/rules match. */
  aiChooseCv: boolean;
  /** Side Panel language: "auto" follows the browser, else "en" | "de" | "ru" (`i18n/core.ts`). */
  uiLanguage: UiLanguagePreference;
  /** Settings → AI fallback: when to answer with Claude instead of OpenAI (`features/openai/fallback.ts`). Needs the Anthropic key. */
  aiFallbackPolicy: AiFallbackPolicy;
  /** Claude model for the main tier (cover letters, outreach) — "" defers to `CLAUDE_MODEL_MAIN`. */
  claudeMainModel: string;
  /** Claude model for every support task — "" defers to `CLAUDE_MODEL_SUPPORT`. */
  claudeSupportModel: string;
  /**
   * Job Search: also search the Bundesagentur für Arbeit's job board (`jobsuche-provider.ts`) next to
   * the chosen provider. On by default; it only runs when the search's place is in Germany, and needs
   * the optional host permission for rest.arbeitsagentur.de (asked for when it's turned on).
   */
  jobsucheEnabled: boolean;
  /** Job Search: also ask TheirStack (with its key, `theirstack-provider.ts`) next to the chosen provider. */
  theirstackEnabled: boolean;
  /** Job Search: also read LoopCV (with its key, `loopcv-provider.ts`) next to the chosen provider. */
  loopcvEnabled: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  autofillOnOpen: true,
  pdfFontSize: 11,
  translateLanguage: "Russian",
  coverLetterModel: "",
  extractionModel: "",
  jobAnalysisModel: "",
  supportModel: "",
  outreachModel: "",
  jobSearchNegativePrompt: "",
  autoSelectCv: true,
  aiChooseCv: false,
  uiLanguage: "auto",
  aiFallbackPolicy: "unavailable",
  claudeMainModel: "",
  claudeSupportModel: "",
  jobsucheEnabled: true,
  theirstackEnabled: true,
  loopcvEnabled: true,
};

/**
 * Preferences that belong to a project (FillerAgent `docs/projects.md`): "what I don't want" is
 * part of a project's search. Default keeps them in `preferences`, as before projects; another
 * project in its own `projectPrefs:<id>` item (each sync item has its own 8 KB).
 */
const PROJECT_PREFERENCES = ["jobSearchNegativePrompt"] as const satisfies readonly (keyof Preferences)[];
type ProjectPreferences = Pick<Preferences, (typeof PROJECT_PREFERENCES)[number]>;

const projectPrefsKey = (projectId: string) => `projectPrefs:${projectId}`;

export async function getPreferences(): Promise<Preferences> {
  const projectId = await currentProjectId();
  const result = await chrome.storage.sync.get("preferences");
  const prefs = { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<Preferences> | undefined) };
  if (projectId === DEFAULT_PROJECT_ID) return prefs;
  const key = projectPrefsKey(projectId);
  const own = ((await chrome.storage.sync.get(key))?.[key] ?? {}) as Partial<ProjectPreferences>;
  for (const name of PROJECT_PREFERENCES) prefs[name] = own[name] ?? DEFAULT_PREFERENCES[name];
  return prefs;
}

export async function setPreferences(preferences: Partial<Preferences>): Promise<void> {
  const projectId = await currentProjectId();
  const result = await chrome.storage.sync.get("preferences");
  const shared = { ...DEFAULT_PREFERENCES, ...(result.preferences as Partial<Preferences> | undefined) };
  if (projectId === DEFAULT_PROJECT_ID) {
    await chrome.storage.sync.set({ preferences: { ...shared, ...preferences } });
    return;
  }
  const own: Partial<ProjectPreferences> = {};
  const rest: Partial<Preferences> = { ...preferences };
  for (const name of PROJECT_PREFERENCES) {
    if (name in rest) {
      own[name] = rest[name];
      delete rest[name];
    }
  }
  if (Object.keys(rest).length > 0) await chrome.storage.sync.set({ preferences: { ...shared, ...rest } });
  if (Object.keys(own).length > 0) {
    const key = projectPrefsKey(projectId);
    const current = ((await chrome.storage.sync.get(key))?.[key] ?? {}) as Partial<ProjectPreferences>;
    await chrome.storage.sync.set({ [key]: { ...current, ...own } });
  }
}
