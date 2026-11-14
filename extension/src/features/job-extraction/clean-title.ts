/**
 * The bare role name of a job title: "Senior Backend Engineer (m/w/d) – Remote"
 * → "Backend Engineer". Drops gender markers, any bracketed aside, seniority
 * levels and trailing work-mode/contract suffixes, so the position field,
 * the Adapt CV `{{job_position}}` value and every prompt that reads
 * `job.position` all see the same clean title.
 */

const SENIORITY =
  "senior|sr\\.?|junior|jr\\.?|middle|mid|mid-level|midlevel|mid-senior|entry-level|entry level|staff|principal|intermediate|regular";

/** Leading or trailing level words, also chained: "Senior/Lead", "Junior-Middle". */
const LEADING_LEVEL = new RegExp(`^(?:(?:${SENIORITY})(?:\\s*[/+&,-]\\s*|\\s+))+`, "i");
const TRAILING_LEVEL = new RegExp(`(?:[\\s,/-]+(?:${SENIORITY}))+$`, "i");
/** "m/w/d", "f/m/x", "all genders" — with or without brackets. */
const GENDER_MARKER = /\b(?:[mwfdx]\s*\/\s*){1,3}[mwfdx]\b|\ball genders?\b|\bgn\b/gi;
/** A separated suffix that only qualifies the posting, not the role. */
const QUALIFIER_SUFFIX =
  /\s+[-–—|:·•]\s+(?:remote|hybrid|on-?site|onsite|full[- ]?time|part[- ]?time|contract|freelance|permanent|temporary|internship|[^-–—|:·•]*\b(?:remote|hybrid|on-?site|full[- ]?time|part[- ]?time)\b[^-–—|:·•]*)\s*$/i;

export function cleanJobTitle(title: string): string {
  let result = title
    .replace(/\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g, " ")
    .replace(GENDER_MARKER, " ")
    .replace(/\s*\|.*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  let previous = "";
  while (previous !== result) {
    previous = result;
    result = result
      .replace(QUALIFIER_SUFFIX, "")
      .replace(/\s*[-–—,/:]+\s*$/, "")
      .replace(/^\s*[-–—,/:]+\s*/, "")
      .trim();
  }

  const withoutLevel = result.replace(LEADING_LEVEL, "").replace(TRAILING_LEVEL, "").trim();
  // A title that is nothing but a level ("Senior") keeps it rather than becoming empty.
  if (withoutLevel) result = withoutLevel.replace(/\s*[-–—,/:]+\s*$/, "").trim();

  // Never return less than nothing: an odd title that cleans to empty stays as it was.
  return result || title.trim();
}
