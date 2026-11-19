import { beforeEach, describe, expect, it } from "vitest";
import { bestTextMatch, fillComboboxAnswer, revealComboboxOptions } from "@/features/autofill/combobox";

/**
 * Ashby's single-select autocomplete (`ashby-application-form-input-autocomplete`), modelled on
 * the live AMBOSS form's "How did you first find out about this position?" (checked 2026-11-19):
 *
 * - an `<input role="combobox" aria-autocomplete="list">` with a toggle `<button>` that has no
 *   `aria-label` (and is `type="submit"`, so the engine must not need it);
 * - the listbox is portaled to the end of `<body>` and referenced through `aria-controls` only
 *   while open;
 * - focus or a click on the input does nothing while the page itself lacks focus (the Side Panel
 *   holds it); ArrowDown opens the full list, typing filters it;
 * - only a click on an option row commits; text typed without picking is discarded on blur.
 *
 * Before the fix the answer "LinkedIn" was typed in, filtered the list down to "Linkedin", was
 * never clicked, and the field read back "" after blur.
 */
const OPTIONS = ["Linkedin", "Career Page", "Referral", "Job Fair", "Search Engine", "Post on Social Media", "Word of mouth ", "Other"];

function mountAshbyAutocomplete(options: string[] = OPTIONS, { asyncOnly = false } = {}): HTMLInputElement {
  document.body.innerHTML = `
    <div data-field-path="77cc143b"><fieldset>
      <label class="ashby-application-form-question-title" for="77cc143b">How did you&nbsp; first find out about this position?</label>
      <div class="_inputContainer"><input class="ashby-application-form-input-autocomplete" placeholder="Start typing..."
        aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox" role="combobox" value="">
        <button class="_toggleButton" aria-hidden="true"><svg></svg></button></div>
    </fieldset></div>`;
  const input = document.querySelector<HTMLInputElement>("input")!;
  let picked = "";
  let listbox: HTMLElement | null = null;
  const close = () => {
    listbox?.remove();
    listbox = null;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-controls");
  };
  const open = () => {
    close();
    const q = input.value.trim().toLowerCase();
    if (asyncOnly && !q) return;
    const shown = options.filter((o) => o.toLowerCase().includes(q));
    if (shown.length === 0) return;
    listbox = document.createElement("div");
    listbox.id = ":r0:";
    listbox.setAttribute("role", "listbox");
    listbox.innerHTML = `<div class="ashby-application-form-input-autocomplete-popup"></div>`;
    for (const text of shown) {
      const row = document.createElement("div");
      row.setAttribute("role", "option");
      row.innerHTML = `<span></span>`;
      row.firstElementChild!.textContent = text;
      row.addEventListener("click", () => {
        picked = text;
        input.value = text;
        close();
      });
      listbox.firstElementChild!.append(row);
    }
    document.body.append(listbox);
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-controls", listbox.id);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" && !listbox) open();
    if (e.key === "Escape") close();
  });
  input.addEventListener("input", open);
  input.addEventListener("blur", () => {
    input.value = picked;
  });
  return input;
}

async function afterBlur(input: HTMLInputElement): Promise<string> {
  input.dispatchEvent(new FocusEvent("blur"));
  await new Promise((r) => setTimeout(r, 0));
  return input.value;
}

describe("Ashby autocomplete answers are picked, not typed", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("selects 'Linkedin' for the answer 'LinkedIn' and keeps it after blur", async () => {
    const input = mountAshbyAutocomplete();
    expect(await fillComboboxAnswer(input, "LinkedIn")).toBe(true);
    expect(await afterBlur(input)).toBe("Linkedin");
  });

  it("matches an option named inside a longer answer, and whole words only", async () => {
    const input = mountAshbyAutocomplete();
    expect(await fillComboboxAnswer(input, "I first saw it on LinkedIn.")).toBe(true);
    expect(await afterBlur(input)).toBe("Linkedin");

    const other = mountAshbyAutocomplete();
    expect(await fillComboboxAnswer(other, "Word of mouth")).toBe(true);
    expect(await afterBlur(other)).toBe("Word of mouth ");
  });

  it("types a search and picks the row when the list only appears for a search term", async () => {
    const input = mountAshbyAutocomplete(OPTIONS, { asyncOnly: true });
    expect(await fillComboboxAnswer(input, "Referral")).toBe(true);
    expect(await afterBlur(input)).toBe("Referral");
  });

  it("never clicks a row of another widget's open list", async () => {
    const input = mountAshbyAutocomplete(OPTIONS, { asyncOnly: true });
    const stray = document.createElement("ul");
    stray.setAttribute("role", "listbox");
    stray.innerHTML = `<li role="option">Something else</li>`;
    let strayClicked = false;
    stray.firstElementChild!.addEventListener("click", () => (strayClicked = true));
    document.body.append(stray);
    await fillComboboxAnswer(input, "Something else");
    expect(strayClicked).toBe(false);
    expect(await afterBlur(input)).toBe("");
  });

  it("reveals the full option list for the question scan", async () => {
    const input = mountAshbyAutocomplete();
    expect(await revealComboboxOptions(input)).toEqual(OPTIONS.map((o) => o.trim()));
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("bestTextMatch", () => {
  it("ignores case, punctuation and spacing", () => {
    expect(bestTextMatch(["Career Page", "Linkedin"], "LinkedIn")).toBe("Linkedin");
    expect(bestTextMatch(["Linked-In", "Other"], "linkedin")).toBe("Linked-In");
    expect(bestTextMatch(["Germany (+49)", "Ghana (+233)"], "Germany")).toBe("Germany (+49)");
  });

  it("matches whole words, never a fragment inside a word", () => {
    expect(bestTextMatch(["Other", "Referral"], "Another source")).toBeNull();
    expect(bestTextMatch(["Yes", "No"], "Not sure")).toBeNull();
    expect(bestTextMatch(["Referral", "Employee referral program"], "Referral")).toBe("Referral");
    expect(bestTextMatch(["Linkedin", "Job Fair"], "Through a LinkedIn post")).toBe("Linkedin");
  });
});
