import { describe, expect, it } from "vitest";
import { detectLocale, resolveLocale, translate } from "@/i18n/core";
import { en } from "@/i18n/messages/en";
import { de } from "@/i18n/messages/de";
import { ru } from "@/i18n/messages/ru";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("picks the first browser language Filler speaks, else English", () => {
    expect(detectLocale(["fr-FR", "de-AT", "en"])).toBe("de");
    expect(detectLocale(["ru"])).toBe("ru");
    expect(detectLocale(["fr", "es"])).toBe("en");
    expect(detectLocale([])).toBe("en");
  });

  it("lets a manual preference override the browser", () => {
    expect(resolveLocale("ru", ["de-DE"])).toBe("ru");
    expect(resolveLocale("auto", ["de-DE"])).toBe("de");
    expect(resolveLocale(undefined, ["en-US"])).toBe("en");
  });

  it("interpolates {vars} and leaves unknown ones in place", () => {
    const key = Object.keys(en).find((k) => placeholders(en[k as keyof typeof en]).length > 0) as keyof typeof en;
    const vars = Object.fromEntries(placeholders(en[key]).map((name) => [name, `<${name}>`]));
    const out = translate("en", key, vars);
    for (const name of Object.keys(vars)) expect(out).toContain(`<${name}>`);
    expect(out).not.toMatch(/\{\w+\}/);
    expect(translate("en", key)).toBe(en[key]);
  });

  it.each([
    ["de", de],
    ["ru", ru],
  ])("%s has every key, non-empty, with the same {placeholders}", (_locale, dictionary) => {
    expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort());
    for (const [key, source] of Object.entries(en)) {
      const translated = dictionary[key as keyof typeof en];
      expect(translated.trim(), key).not.toBe("");
      expect(placeholders(translated), key).toEqual(placeholders(source));
    }
  });
});
