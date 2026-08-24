/** CEFR proficiency scale (spec_3 item 2), low to high — index order doubles as comparison order. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "Native"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

/** True when `own` is at least as high as `required` on the CEFR scale. */
export function meetsLevel(required: CefrLevel, own: CefrLevel): boolean {
  return CEFR_LEVELS.indexOf(own) >= CEFR_LEVELS.indexOf(required);
}
