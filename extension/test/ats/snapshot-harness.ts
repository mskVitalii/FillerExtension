import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Loads a sanitized ATS form snapshot (`test/ats/<ats>/<name>.html`, see `README.md`) into jsdom
 * and brings its JavaScript widgets back to life. The snapshots are inert HTML; on the live page
 * React drives the dropdowns, so each widget kind is re-created here with the same contract the
 * live widget has (only a click on an option row selects; typing just searches) — enough for the
 * real engine modules to be tested against the real markup.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

export type Ats = "greenhouse" | "lever" | "ashby";

const INLINE_HANDLER_ATTRS = ["onblur", "oninput", "onchange", "onkeyup", "onkeydown", "onkeypress", "onclick"] as const;

/**
 * Stand-in for the live geocoders behind location autocompletes, in each ATS's own result format
 * (captured live 2026-11-18: Greenhouse and Ashby "Berlin, Germany", Lever "Berlin, DEU"). A same-named US town
 * comes first on purpose, so a pick that ignores the applicant's country fails.
 */
const GEOCODERS: Record<Ats, Record<string, string[]>> = {
  greenhouse: { berlin: ["Berlin, New Hampshire, United States", "Berlin, Germany", "Berlin, Wisconsin, United States"] },
  lever: { berlin: ["Berlin, CT, USA", "Berlin, DEU", "Berlin, Usulutan, SLV"] },
  ashby: { berlin: ["Berlin, New Hampshire, United States", "Berlin, Germany", "Berlin, Maryland, United States"] },
};

function geocode(ats: Ats, query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const table = GEOCODERS[ats];
  const key = Object.keys(table).find((k) => k.startsWith(q) || q.startsWith(k));
  return key ? table[key] : [];
}

export function loadAtsFixture(ats: Ats, name: string): void {
  const html = readFileSync(path.join(here, ats, `${name}.html`), "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  for (const attr of INLINE_HANDLER_ATTRS) {
    for (const el of document.body.querySelectorAll(`[${attr}]`)) {
      (el as unknown as Record<string, unknown>)[attr] = null;
    }
  }
  wireReactSelects();
  wireAshbyAutocompletes();
  wireAshbyYesNo();
  wireLeverLocation();
}

function fixtureOptions(input: HTMLElement): string[] {
  const raw = input.getAttribute("data-fixture-options");
  return raw ? (JSON.parse(raw) as string[]) : [];
}

/**
 * Greenhouse's react-select (`select__*` class prefix): mousedown on the Control or ArrowDown
 * opens the menu, the "Toggle flyout" indicator toggles it on mousedown, typing filters, and only
 * clicking an option row sets the single value (and the hidden `requiredInput` mirror). The
 * Location (City) field (`#candidate-location`) is an *async* select: no options until a search
 * term is typed, then geocoder results.
 */
function wireReactSelects(): void {
  for (const input of document.querySelectorAll<HTMLInputElement>("input.select__input")) {
    const shell = input.closest<HTMLElement>(".select-shell") ?? input.closest<HTMLElement>(".select__container")!;
    const control = shell.querySelector<HTMLElement>(".select__control")!;
    const valueContainer = shell.querySelector<HTMLElement>(".select__value-container")!;
    const toggle = shell.querySelector<HTMLElement>('button[aria-label="Toggle flyout"]');
    const mirror = shell.parentElement?.querySelector<HTMLInputElement>('input[aria-hidden="true"][tabindex="-1"]') ?? null;
    const isAsync = input.id === "candidate-location";
    const staticOptions = fixtureOptions(input);
    const id = input.id || "anon";
    let menu: HTMLElement | null = null;

    const close = () => {
      menu?.remove();
      menu = null;
      input.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      close();
      const options = isAsync ? geocode("greenhouse", input.value) : staticOptions.filter((o) => o.toLowerCase().includes(input.value.trim().toLowerCase()));
      menu = document.createElement("div");
      menu.className = "select__menu";
      menu.id = `react-select-${id}-listbox`;
      menu.setAttribute("role", "listbox");
      if (options.length === 0) {
        const notice = document.createElement("div");
        notice.className = "select__menu-notice";
        notice.textContent = isAsync ? "Type to search" : "No options";
        menu.append(notice);
      }
      options.forEach((text, i) => {
        const option = document.createElement("div");
        option.className = "select__option";
        option.id = `react-select-${id}-option-${i}`;
        option.setAttribute("role", "option");
        option.textContent = text;
        option.addEventListener("click", () => {
          valueContainer.querySelector(".select__single-value")?.remove();
          valueContainer.querySelector(".select__placeholder")?.replaceChildren();
          const value = document.createElement("div");
          value.className = "select__single-value";
          value.textContent = text;
          valueContainer.prepend(value);
          input.value = "";
          if (mirror) mirror.value = text;
          close();
        });
        menu!.append(option);
      });
      shell.append(menu);
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", menu.id);
    };

    control.addEventListener("mousedown", (e) => {
      if (e.target instanceof Element && e.target.closest("button")) return;
      if (!menu) open();
    });
    toggle?.addEventListener("mousedown", () => (menu ? close() : open()));
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" && !menu) open();
      if (e.key === "Escape") close();
    });
    input.addEventListener("input", () => open());
  }
}

/**
 * Ashby's autocomplete (`ashby-application-form-input-autocomplete`, used for Location and for
 * long single-select lists): focusing/clicking opens a listbox under the input, typing filters
 * (or geocodes, for the Location system field), clicking an option writes its text into the
 * input. Text typed without picking is discarded on blur, as on the live form.
 */
function wireAshbyAutocompletes(): void {
  document.querySelectorAll<HTMLInputElement>("input.ashby-application-form-input-autocomplete").forEach((input, n) => {
    const container = input.parentElement!;
    const isLocation = input.closest('[data-field-path="_systemfield_location"]') !== null;
    const staticOptions = fixtureOptions(input);
    let picked = "";
    let menu: HTMLElement | null = null;
    const close = () => {
      menu?.remove();
      menu = null;
      input.setAttribute("aria-expanded", "false");
    };
    const open = () => {
      close();
      const q = input.value.trim().toLowerCase();
      const options = isLocation ? geocode("ashby", q) : staticOptions.filter((o) => o.toLowerCase().includes(q));
      if (options.length === 0) return;
      menu = document.createElement("div");
      menu.id = `ashby-autocomplete-${n}`;
      menu.setAttribute("role", "listbox");
      for (const text of options) {
        const option = document.createElement("div");
        option.setAttribute("role", "option");
        option.textContent = text;
        option.addEventListener("click", () => {
          picked = text;
          input.value = text;
          close();
        });
        menu.append(option);
      }
      container.append(menu);
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", menu.id);
    };
    input.addEventListener("focus", open);
    input.addEventListener("click", open);
    input.addEventListener("input", open);
    input.addEventListener("blur", () => {
      // Ashby keeps only a picked option; free text is reverted.
      setTimeout(() => {
        if (input.value !== picked) input.value = picked;
      }, 0);
    });
    container.querySelector("button")?.addEventListener("click", () => (menu ? close() : open()));
  });
}

/**
 * Lever's "Current location" typeahead (`#location-input`): typing shows `.dropdown-location` rows
 * (not ARIA options) under the field; clicking one writes its text into the input and a JSON
 * blob into the hidden `selectedLocation`.
 */
function wireLeverLocation(): void {
  const input = document.querySelector<HTMLInputElement>("#location-input");
  if (!input) return;
  const hidden = document.querySelector<HTMLInputElement>('input[name="selectedLocation"]');
  const dropdown = document.createElement("div");
  dropdown.className = "dropdown-container location-dropdown";
  const results = document.createElement("div");
  results.className = "dropdown-results";
  dropdown.append(results);
  input.after(dropdown);
  // Lever's jQuery handler runs on keyup and ignores a key event without a keyCode (checked live).
  input.addEventListener("keyup", (e) => {
    if (!e.keyCode) return;
    results.replaceChildren();
    geocode("lever", input.value).forEach((text, i) => {
      const row = document.createElement("div");
      row.className = "break-word dropdown-location width-full py1 px2";
      row.id = `location-${i}`;
      row.textContent = text;
      row.addEventListener("click", () => {
        input.value = text;
        if (hidden) hidden.value = JSON.stringify({ name: text });
        results.replaceChildren();
      });
      results.append(row);
    });
  });
}

/** Ashby's Yes/No toggle buttons: a click presses one and releases the other. */
function wireAshbyYesNo(): void {
  for (const group of document.querySelectorAll<HTMLElement>(".ashby-application-form-input-yesno")) {
    const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>("button"));
    for (const button of buttons) {
      button.addEventListener("click", (e) => {
        e.preventDefault();
        for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      });
    }
  }
}

/** What a react-select shows as selected (its single value), or "" when nothing is picked. */
export function reactSelectValue(input: HTMLElement): string {
  const shell = input.closest(".select-shell") ?? input.closest(".select__container");
  return shell?.querySelector(".select__single-value")?.textContent ?? "";
}

/** The value a field holds as the applicant would see it: a react-select's single value, else `.value`. */
export function shownValue(el: Element | null): string {
  if (!el) return "";
  if (el instanceof HTMLInputElement && el.classList.contains("select__input")) return reactSelectValue(el);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el instanceof HTMLInputElement && el.type === "number" ? el.value : el.value;
  }
  return el.textContent ?? "";
}

/** Every user-facing text control of the form (not file/radio/checkbox, not hidden mirrors), for "nothing else was touched" checks. */
export function textControls(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([type="file"]):not([type="radio"]):not([type="checkbox"]):not([type="submit"]), textarea, select',
    ),
  ).filter((el) => !(el.getAttribute("aria-hidden") === "true" && el.getAttribute("tabindex") === "-1"));
}

/** A file shaped like the fictional applicant's CV / cover letter. */
export function pdf(name: string): File {
  return new File(["%PDF-1.4 fixture"], name, { type: "application/pdf" });
}

/** Fill-rate bookkeeping, printed per fixture so before/after numbers can be compared. */
export interface FieldExpectation {
  /** CSS selector of the field. */
  sel: string;
  /** Expected shown value, or a predicate. */
  want: string | RegExp;
  label: string;
}

export function scoreFields(expectations: FieldExpectation[]): { ok: number; total: number; misses: string[] } {
  const misses: string[] = [];
  let ok = 0;
  for (const e of expectations) {
    const got = shownValue(document.querySelector(e.sel));
    const pass = typeof e.want === "string" ? got === e.want : e.want.test(got);
    if (pass) ok++;
    else misses.push(`${e.label}: got ${JSON.stringify(got)}, want ${String(e.want)}`);
  }
  return { ok, total: expectations.length, misses };
}
