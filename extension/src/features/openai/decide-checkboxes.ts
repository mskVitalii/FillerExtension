export type CheckboxCategory = "required-consent" | "marketing" | "optional" | "unclear";

export interface CheckboxDecision {
  name: string;
  label: string;
  check: boolean;
  category: CheckboxCategory;
  reason: string;
  /** 0..1, from the Decisions API; absent when the decision came from the Responses fallback. */
  confidence?: number;
}
