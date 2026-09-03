import type { ProfileFieldKey } from "@/types/profile";
import { PROFILE_FIELD_LABELS } from "@/features/profile/labels";

export type InsertField = ProfileFieldKey | "cv" | "coverLetter" | "generatePassword";

/**
 * Single source of truth for the right-click "Insert" menu's item order and
 * human-readable labels — used both to build the context menu itself
 * (background/context-menu.ts) and to name the field in the on-page
 * confirmation toast (content/index.ts) so the two never drift apart.
 */
export const INSERT_FIELD_LABELS: Record<InsertField, string> = {
  ...PROFILE_FIELD_LABELS,
  cv: "CV",
  coverLetter: "Cover Letter",
  generatePassword: "Generated password",
};

export const INSERT_FIELD_ORDER = Object.keys(INSERT_FIELD_LABELS) as InsertField[];
