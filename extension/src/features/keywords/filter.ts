import type { Job, JobKeyword } from "@/types/job";
import { COUNTRIES } from "@/lib/countries";

/**
 * Offline safety net behind the keyword prompt (`keywords/prompt.ts`): the
 * model still slips in the company, the city, a benefit or a generic word now
 * and then. Only obvious junk is dropped here — anything that could be a real
 * skill stays, since the prompt already did the judging.
 */

type JobContext = Pick<Job, "company" | "location" | "position">;

/** Exact (normalized) phrases that are never a hard or soft skill. EN, DE, RU. */
const STOP_PHRASES = new Set([
  // generic nouns
  "team", "teams", "experience", "work", "job", "role", "position", "company", "candidate",
  "opportunity", "environment", "product", "products", "customer", "customers", "client",
  "clients", "project", "projects", "skills", "knowledge", "ability", "responsibilities",
  "requirements", "tasks", "career", "growth", "culture", "mission", "vision", "values",
  "impact", "passion", "motivation", "startup", "scale-up", "industry", "business",
  "fast-paced environment", "dynamic environment", "nice to have", "must have", "plus",
  "years", "year", "years of experience", "professional experience", "work experience",
  "degree", "bachelor", "bachelor's degree", "master", "master's degree", "university degree",
  "diploma", "phd",
  // seniority
  "intern", "internship", "junior", "middle", "mid-level", "senior", "lead", "principal",
  "staff", "head", "manager",
  // work mode / contract
  "remote", "fully remote", "remote work", "hybrid", "on-site", "onsite", "office", "in office",
  "home office", "homeoffice", "relocation", "visa sponsorship", "full-time", "full time",
  "part-time", "part time", "contract", "freelance", "permanent", "temporary",
  // pay / benefits
  "salary", "competitive salary", "bonus", "equity", "stock options", "esop", "benefits",
  "vacation", "paid time off", "pto", "holidays", "health insurance", "insurance", "pension",
  "gym", "gym membership", "free lunch", "snacks", "flexible hours", "flexible working hours",
  "learning budget", "parental leave",
  // DE
  "erfahrung", "berufserfahrung", "aufgaben", "anforderungen", "unternehmen", "vollzeit",
  "teilzeit", "festanstellung", "gehalt", "urlaub", "vertrag", "büro", "mobiles arbeiten",
  // RU
  "команда", "опыт", "опыт работы", "работа", "компания", "проект", "проекты", "задачи",
  "требования", "обязанности", "удаленно", "удаленка", "удаленная работа", "гибрид", "офис",
  "полный день", "полная занятость", "частичная занятость", "зарплата", "оклад", "бонусы",
  "дмс", "отпуск", "релокация",
]);

const COUNTRY_NAMES = new Set(COUNTRIES.map((country) => normalize(country)));

// `\b` is ASCII-only, hence the lookbehind (for "ООО").
const LEGAL_SUFFIX = /\s*,?\s*(?<![\p{L}\p{N}])(?:inc|ltd|llc|gmbh|ag|se|kg|ug|bv|nv|sa|sas|srl|plc|corp|corporation|co|company|oy|ab|as|ооо|ао)\.?$/iu;

function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[’`]/g, "'")
    .replace(/^[\s"'«».,:;!?()[\]-]+|[\s"'«».,:;!?()[\]-]+$/g, "")
    .replace(/\s+/g, " ");
}

/** "Acme Robotics GmbH" → ["acme robotics gmbh", "acme robotics"]. */
function companyNames(company: string): string[] {
  const full = normalize(company);
  if (!full) return [];
  const bare = normalize(full.replace(LEGAL_SUFFIX, ""));
  return bare && bare !== full ? [full, bare] : [full];
}

/** "Munich, Bavaria, Germany (Hybrid)" → the whole string plus each part. */
function locationNames(location: string): string[] {
  const full = normalize(location);
  if (!full) return [];
  const parts = location
    .split(/[,/|·•()]/)
    .map(normalize)
    .filter(Boolean);
  return [full, ...parts];
}

/** "Backend Engineer (m/w/d)" → "backend engineer". */
function titleName(position: string): string {
  return normalize(position.replace(/\((?:[mwfdx]\s*\/\s*)+[mwfdx]\)/gi, ""));
}

const YEARS = /^\d+(?:\s*[-–+]\s*\d*)?\+?\s*(?:years?|yrs?|jahre?n?|лет|года?|ans|años)(?![\p{L}\p{N}])/iu;

export function isJunkKeyword(text: string, job: JobContext): boolean {
  const trimmed = text.trim();
  // A single letter is only a skill as an uppercase language name ("R", "C").
  if ([...trimmed].length < 2) return !/^\p{Lu}$/u.test(trimmed);
  if (!/\p{L}/u.test(trimmed)) return true;
  if (/[$€£¥₽%]/u.test(trimmed)) return true;

  const key = normalize(trimmed);
  if (!key || STOP_PHRASES.has(key) || COUNTRY_NAMES.has(key) || YEARS.test(key)) return true;
  if (companyNames(job.company).includes(key)) return true;
  if (locationNames(job.location).includes(key)) return true;
  return key === titleName(job.position);
}

/** Drops junk and case-insensitive duplicates, keeping the model's order. */
export function filterJobKeywords(keywords: JobKeyword[], job: JobContext): JobKeyword[] {
  const seen = new Set<string>();
  return keywords.filter((keyword) => {
    const key = normalize(keyword.text);
    if (seen.has(key) || isJunkKeyword(keyword.text, job)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The same filter over a `{{keywords}}` CV value ("TypeScript, Remote, React"),
 * keeping its own separator. A value without any separator is left alone
 * unless the whole thing is junk.
 */
export function filterKeywordList(value: string, job: JobContext): string {
  const separator = value.match(/\s*[,;|·•]\s*/u)?.[0];
  if (!separator) return isJunkKeyword(value, job) ? "" : value;
  const seen = new Set<string>();
  return value
    .split(/\s*[,;|·•]\s*/u)
    .filter((item) => {
      const key = normalize(item);
      if (!item.trim() || seen.has(key) || isJunkKeyword(item, job)) return false;
      seen.add(key);
      return true;
    })
    .join(separator);
}
