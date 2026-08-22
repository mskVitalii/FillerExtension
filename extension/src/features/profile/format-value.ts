import type { ProfileFieldKey } from "@/types/profile";

const URL_LIKE_FIELDS = new Set<ProfileFieldKey>(["linkedin", "github", "website"]);

/**
 * Short display text for a profile value — e.g. a LinkedIn/GitHub/website
 * URL shows only its last path segment ("mskvitalii" instead of the full
 * "https://www.linkedin.com/in/mskvitalii/"). Purely cosmetic: the full
 * value is still what gets dragged/autofilled, this only affects the label
 * shown in the Side Panel list.
 */
export function formatProfileValueForDisplay(field: ProfileFieldKey, value: string): string {
  if (!value || !URL_LIKE_FIELDS.has(field)) return value;

  const withoutProtocol = value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  const segments = withoutProtocol.split("/").filter(Boolean);
  return segments[segments.length - 1] || withoutProtocol;
}
