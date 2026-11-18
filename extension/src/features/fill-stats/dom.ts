import { isComboboxLike } from "@/features/autofill/combobox";
import type { FieldKind } from "./stats";

const INPUT_KINDS: Record<string, FieldKind> = {
  text: "text",
  search: "text",
  email: "email",
  tel: "tel",
  url: "url",
  number: "number",
  date: "date",
  "datetime-local": "date",
  month: "date",
  week: "date",
  file: "file",
  checkbox: "checkbox",
  radio: "radio",
};

/** The widget a field is, for grouping fill statistics ("Greenhouse comboboxes fail"). */
export function fieldKind(el: HTMLElement): FieldKind {
  if (isComboboxLike(el)) return "combobox";
  if (el instanceof HTMLSelectElement) return "select";
  if (el instanceof HTMLTextAreaElement) return "textarea";
  if (el instanceof HTMLInputElement) return INPUT_KINDS[el.type] ?? "other";
  if (el.getAttribute("contenteditable") === "true" || el.isContentEditable) return "contenteditable";
  return "other";
}
