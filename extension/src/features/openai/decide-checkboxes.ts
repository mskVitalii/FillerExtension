export type CheckboxCategory = "required-consent" | "marketing" | "optional" | "unclear";

export interface CheckboxDecision {
  name: string;
  label: string;
  check: boolean;
  category: CheckboxCategory;
  reason: string;
}
