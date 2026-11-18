import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { EMPTY_PROFILE } from "@/types/profile";

/**
 * A minimal react-select as greenhouse.io renders it: the input holds only search text, the menu
 * renders on mousedown on the Control, and a value exists only once an option row is clicked.
 */
function reactSelect(id: string, label: string, options: string[]): { input: HTMLInputElement; shown: () => string } {
  const root = document.createElement("div");
  root.innerHTML = `
    <label id="${id}-label" for="${id}">${label}</label>
    <div class="select__container">
      <div class="select__control">
        <div class="select__value-container"><div class="select__input-container">
          <input id="${id}" class="select__input" role="combobox" aria-expanded="false" aria-labelledby="${id}-label" value="" />
        </div></div>
      </div>
    </div>`;
  document.body.append(root);
  const input = root.querySelector("input")!;
  const control = root.querySelector<HTMLElement>(".select__control")!;
  const container = root.querySelector<HTMLElement>(".select__value-container")!;
  control.addEventListener("mousedown", () => {
    if (root.querySelector('[role="listbox"]')) return;
    const list = document.createElement("div");
    list.id = `react-select-${id}-listbox`;
    list.setAttribute("role", "listbox");
    input.setAttribute("aria-controls", list.id);
    options.forEach((text, i) => {
      const option = document.createElement("div");
      option.id = `react-select-${id}-option-${i}`;
      option.setAttribute("role", "option");
      option.textContent = text;
      option.addEventListener("click", () => {
        container.querySelector(".select__single-value")?.remove();
        const value = document.createElement("div");
        value.className = "select__single-value";
        value.textContent = text;
        container.prepend(value);
        list.remove();
      });
      list.append(option);
    });
    root.append(list);
  });
  input.addEventListener("input", () => {
    /* typing only filters; it never selects */
  });
  return { input, shown: () => container.querySelector(".select__single-value")?.textContent ?? "" };
}

describe("profile values in react-select dropdowns", () => {
  it("picks the pronouns option instead of typing into the search box", async () => {
    const { input, shown } = reactSelect("4024721002", "My pronouns are:*", ["She/Her", "He/Him", "They/Them", "I prefer not to answer"]);
    const result = await autofillDocument({ ...EMPTY_PROFILE, pronouns: "He/Him" });
    expect(shown()).toBe("He/Him");
    expect(input.value).toBe("");
    expect(result.filled).toBe(1);
  });

  it("leaves it unset (not typed) when no option matches", async () => {
    document.body.innerHTML = "";
    const { input, shown } = reactSelect("p2", "Pronouns", ["She/Her", "They/Them"]);
    const result = await autofillDocument({ ...EMPTY_PROFILE, pronouns: "He/Him" });
    expect(shown()).toBe("");
    expect(input.value).toBe("");
    expect(result.filled).toBe(0);
  });
});
